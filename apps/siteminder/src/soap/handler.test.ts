import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { AriBatch, AriResult } from "@openbookings/apps-contract";
import type { CoreClient } from "../core-client";
import type { Queryable } from "../db/migrate";
import { createApp } from "../index";
import { type AppInstallation, upsertInstallation } from "../installations";
import { serialized, skipDbTests, withTestDb } from "../testing/db-harness";
import { tick } from "../tick";

const reg = {
  installationId: "6d1c0a52-6b1e-4b57-9f0e-2b6a4e7a9c81",
  propertyCode: "SM-NOTIF-2031",
  propertyName: "Hotel Notif",
  apiKey: "key-notif",
  coreBaseUrl: "https://core.example",
};
const NOW = new Date("2031-04-01T08:00:00.000Z");

const envelope = (inner: string, user = "sm-user", pass = "sm-pass") =>
  `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header><wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wsse:UsernameToken><wsse:Username>${user}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${pass}</wsse:Password></wsse:UsernameToken></wsse:Security></SOAP-ENV:Header><SOAP-ENV:Body>${inner}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const availRq = (echo: string, messages: string, hotel = reg.propertyCode) =>
  envelope(
    `<OTA_HotelAvailNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05" EchoToken="${echo}" TimeStamp="2031-04-01T08:00:00+00:00" Version="1.0"><AvailStatusMessages HotelCode="${hotel}">${messages}</AvailStatusMessages></OTA_HotelAvailNotifRQ>`,
  );
const limit = (start: string, end: string, units = 5) =>
  `<AvailStatusMessage BookingLimit="${units}"><StatusApplicationControl Start="${start}" End="${end}" InvTypeCode="RNOTIF2031" RatePlanCode="PNOTIF2031"/></AvailStatusMessage>`;
const rateRq = (echo: string, bases: string, currency = "EUR") =>
  envelope(
    `<OTA_HotelRateAmountNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05" EchoToken="${echo}" TimeStamp="2031-04-01T08:00:00+00:00" Version="1.0"><RateAmountMessages HotelCode="${reg.propertyCode}"><RateAmountMessage><StatusApplicationControl Start="2031-06-01" End="2031-06-07" RatePlanCode="PNOTIF2031"/><Rates><Rate><BaseByGuestAmts>${bases.replaceAll("{cur}", currency)}</BaseByGuestAmts></Rate></Rates></RateAmountMessage></RateAmountMessages></OTA_HotelRateAmountNotifRQ>`,
  );

const post = (app: ReturnType<typeof createApp>, body: string) =>
  app.request("/soap", { method: "POST", body, headers: { "Content-Type": "text/xml; charset=utf-8" } });

async function inboxRows(db: Queryable) {
  return (await db.query<{ echo_token: string; kind: string; changes: Partial<AriBatch> }>(`SELECT echo_token, kind, changes FROM siteminder.inbox ORDER BY id`)).rows;
}

describe.skipIf(skipDbTests)("SOAP notif messages (rolled back)", () => {
  const saved: Record<string, string | undefined> = {};
  const info: unknown[][] = [];
  const spies = [spyOn(console, "info").mockImplementation((...args: unknown[]) => { info.push(args); })];
  beforeAll(() => {
    for (const k of ["SITEMINDER_INBOUND_USERNAME", "SITEMINDER_INBOUND_PASSWORD"]) saved[k] = process.env[k];
    process.env.SITEMINDER_INBOUND_USERNAME = "sm-user";
    process.env.SITEMINDER_INBOUND_PASSWORD = "sm-pass";
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const s of spies) s.mockRestore();
  });
  const noCore = () => { throw new Error("SiteMinder's reply must not wait on core"); };

  it("replies to a 750-day availability message in under 2 s while core takes 10 s, then the tick sends it", async () => {
    await withTestDb(async (connection) => {
      const db = serialized(connection);
      await upsertInstallation(db, reg);
      // Core "takes 10 s": its reply is held until the test lets it go, long after SiteMinder got its answer.
      let release!: (r: AriResult) => void;
      const coreAnswer = new Promise<AriResult>((resolve) => { release = resolve; });
      let called!: (b: AriBatch) => void;
      const coreCalled = new Promise<AriBatch>((resolve) => { called = resolve; });
      const slowClient = (_: AppInstallation) => ({ writeAri: (b: AriBatch) => { called(b); return coreAnswer; } }) as unknown as CoreClient;
      const ticks: Promise<unknown>[] = [];
      const kickTick = (installationId: string) => {
        ticks.push(tick({ db, client: slowClient, now: () => NOW, sleep: async () => {} }, { installationId }));
      };
      const app = createApp(() => db, { now: () => NOW, clientFor: noCore, kickTick });

      const echo = crypto.randomUUID();
      const started = performance.now();
      const res = await post(app, availRq(echo, limit("2031-01-01", "2033-01-19")));
      const elapsed = performance.now() - started;
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(text).toContain("<OTA_HotelAvailNotifRS");
      expect(text).toContain("<Success/>");
      expect(text).toContain(`EchoToken="${echo}"`);
      expect(elapsed).toBeLessThan(2_000);
      expect(await inboxRows(db)).toEqual([
        { echo_token: echo, kind: "HotelAvailNotifRQ", changes: { inventory: [{ roomCode: "RNOTIF2031", from: "2031-01-01", to: "2033-01-19", unitsLeft: 5 }], restrictions: [] } },
      ]);

      // The tick was started after the reply and is waiting on core.
      expect(ticks).toHaveLength(1);
      const sent = await coreCalled;
      expect(sent.inventory).toEqual([{ roomCode: "RNOTIF2031", from: "2031-01-01", to: "2033-01-19", unitsLeft: 5 }]);
      release({ ok: true, nights: 750 });
      expect(await ticks[0]).toEqual({ inboxApplied: 1, inboxFailed: 0 });
    });
  });

  it("stores the same EchoToken once and answers Success both times", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const kicked: string[] = [];
      const app = createApp(() => db, { now: () => NOW, clientFor: noCore, kickTick: (id) => kicked.push(id) });
      const echo = crypto.randomUUID();
      const body = availRq(echo, limit("2031-05-01", "2031-05-03"));
      for (let i = 0; i < 2; i++) {
        const text = await (await post(app, body)).text();
        expect(text).toContain("<Success/>");
        expect(text).toContain(`EchoToken="${echo}"`);
      }
      expect(await inboxRows(db)).toHaveLength(1);
      await Promise.resolve();
      expect(kicked).toEqual([reg.installationId]);
    });
  });

  it("stores a rate message, and logs the Single Guest amount it ignores", async () => {
    await withTestDb(async (db) => {
      info.length = 0;
      await upsertInstallation(db, reg);
      const app = createApp(() => db, { now: () => NOW, clientFor: noCore });
      const echo = crypto.randomUUID();
      const res = await post(app, rateRq(echo, `<BaseByGuestAmt AmountAfterTax="186.50" CurrencyCode="{cur}"/><BaseByGuestAmt NumberOfGuests="1" AmountAfterTax="150.00" CurrencyCode="{cur}"/>`));
      expect(await res.text()).toContain("<Success/>");
      expect(await inboxRows(db)).toEqual([
        { echo_token: echo, kind: "HotelRateAmountNotifRQ", changes: { rates: [{ ratePlanCode: "PNOTIF2031", from: "2031-06-01", to: "2031-06-07", priceCents: 18650, extraAdultCents: null, extraChildCents: null }] } },
      ]);
      expect(info.some((args) => String(args[0]).includes("ignored") && JSON.stringify(args).includes("150.00"))).toBe(true);
    });
  });

  it("answers a message that maps to nothing with Success and stores nothing", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const app = createApp(() => db, { now: () => NOW, clientFor: noCore });
      const empty = `<AvailStatusMessage><StatusApplicationControl Start="2031-05-01" End="2031-05-01" InvTypeCode="RNOTIF2031" RatePlanCode="PNOTIF2031"/></AvailStatusMessage>`;
      expect(await (await post(app, availRq(crypto.randomUUID(), empty))).text()).toContain("<Success/>");
      expect(await inboxRows(db)).toEqual([]);
    });
  });

  it("answers an unknown HotelCode with 392, a refused amount with its error, and stores neither", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const app = createApp(() => db, { now: () => NOW, clientFor: noCore });
      const unknown = await (await post(app, availRq(crypto.randomUUID(), limit("2031-05-01", "2031-05-01"), "SM-NOPE-2031"))).text();
      expect(unknown).toContain(`<Error Type="6" Code="392">Hotel not found for HotelCode=SM-NOPE-2031</Error>`);
      const usd = await (await post(app, rateRq(crypto.randomUUID(), `<BaseByGuestAmt AmountAfterTax="186.50" CurrencyCode="{cur}"/>`, "USD"))).text();
      expect(usd).toContain(`<Error Type="12">Currency USD is not supported: send rates in EUR</Error>`);
      expect(await inboxRows(db)).toEqual([]);
    });
  });

  it("refuses an EchoToken that is not a UUID", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const app = createApp(() => db, { now: () => NOW, clientFor: noCore });
      const text = await (await post(app, availRq("not-a-uuid", limit("2031-05-01", "2031-05-01")))).text();
      expect(text).toContain(`<Error Type="10">EchoToken must be a UUID</Error>`);
      expect(await inboxRows(db)).toEqual([]);
    });
  });

  describe("codes checked against the cached structure", () => {
    const structure = {
      propertyCode: reg.propertyCode,
      propertyName: reg.propertyName,
      timezone: "Europe/Amsterdam",
      rooms: [{ code: "RNOTIF2031", name: "Double", baseOccupancy: 2, maxAdults: 2, maxChildren: 0, ratePlans: [
        { code: "PNOTIF2031", name: "Room only", isRefundable: true, includesBreakfast: false, includesLunch: false, includesDinner: false },
      ] }],
    };
    const cache = (db: Queryable) =>
      db.query(`UPDATE siteminder.installations SET structure = $2::jsonb, structure_fetched_at = $3 WHERE id = $1`, [
        reg.installationId, JSON.stringify(structure), new Date(NOW.getTime() - 86_400_000).toISOString(),
      ]);
    const ctl = (room: string, plan: string) => `<StatusApplicationControl Start="2031-05-01" End="2031-05-02" InvTypeCode="${room}" RatePlanCode="${plan}"/>`;

    it("answers 402 for an unknown room type and 249 for an unknown rate, at once, storing nothing", async () => {
      await withTestDb(async (db) => {
        await upsertInstallation(db, reg);
        await cache(db);
        const app = createApp(() => db, { now: () => NOW, clientFor: noCore });

        const room = await (await post(app, availRq(crypto.randomUUID(), `<AvailStatusMessage BookingLimit="2">${ctl("RNOPE2031", "PNOTIF2031")}</AvailStatusMessage>`))).text();
        expect(room).toContain(`<Error Type="12" Code="402">Room type code not found for this hotel</Error>`);
        expect(room).not.toContain("<Success/>");

        const plan = await (await post(app, availRq(crypto.randomUUID(), `<AvailStatusMessage>${ctl("RNOTIF2031", "PNOPE2031")}<RestrictionStatus Status="Close"/></AvailStatusMessage>`))).text();
        expect(plan).toContain(`<Error Type="12" Code="249">Rate code not found for this hotel</Error>`);

        const rate = await (await post(app, rateRq(crypto.randomUUID(), `<BaseByGuestAmt AmountAfterTax="186.50" CurrencyCode="{cur}"/>`).replace("PNOTIF2031", "PNOPE2031"))).text();
        expect(rate).toContain(`<Error Type="12" Code="249">Rate code not found for this hotel</Error>`);

        expect(await inboxRows(db)).toEqual([]);
      });
    });

    it("known codes are stored and answered Success", async () => {
      await withTestDb(async (db) => {
        await upsertInstallation(db, reg);
        await cache(db);
        const app = createApp(() => db, { now: () => NOW, clientFor: noCore });
        const text = await (await post(app, availRq(crypto.randomUUID(), `<AvailStatusMessage BookingLimit="2">${ctl("RNOTIF2031", "PNOTIF2031")}</AvailStatusMessage>`))).text();
        expect(text).toContain("<Success/>");
        expect(await inboxRows(db)).toHaveLength(1);
      });
    });

    it("without a cached structure the codes are left to core: stored and answered Success", async () => {
      await withTestDb(async (db) => {
        await upsertInstallation(db, reg);
        const app = createApp(() => db, { now: () => NOW, clientFor: noCore });
        const text = await (await post(app, availRq(crypto.randomUUID(), `<AvailStatusMessage BookingLimit="2">${ctl("RNOPE2031", "PNOTIF2031")}</AvailStatusMessage>`))).text();
        expect(text).toContain("<Success/>");
        expect(await inboxRows(db)).toHaveLength(1);
      });
    });
  });
});
