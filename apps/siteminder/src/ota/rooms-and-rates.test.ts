import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { AppStructure } from "@openbookings/apps-contract";
import { CoreApiError } from "../core-client";
import { createApp } from "../index";
import { type AppInstallation, upsertInstallation } from "../installations";
import { buildResponse } from "../soap/envelope";
import { skipDbTests, withTestDb } from "../testing/db-harness";
import { roomsAndRatesPayload, structureFor } from "./rooms-and-rates";

const plan = (code: string, name: string) => ({
  code, name, isRefundable: true, includesBreakfast: false, includesLunch: false, includesDinner: false,
});
const structure: AppStructure = {
  propertyCode: "SM-RR-2031",
  propertyName: "Hotel RR",
  timezone: "Europe/Amsterdam",
  rooms: [
    { code: "SGL", name: "Single Room", baseOccupancy: 1, maxAdults: 1, maxChildren: 1, ratePlans: [plan("BAR", "Best Available Rate"), plan("NR", "Non Refundable")] },
    { code: "DBL", name: "Double Room", baseOccupancy: 2, maxAdults: 2, maxChildren: 1, ratePlans: [plan("BAR", "Best Available Rate"), plan("BNB", "Bed & Breakfast")] },
  ],
};

const ECHO = "ed8835ff-6198-4f38-b589-3058397f677c";
const NOW = new Date("2031-03-01T10:00:00.000Z");
const stay = (room: string, roomName: string, max: number, rate: string, rateName: string) =>
  `<RoomStay><RoomTypes><RoomType RoomTypeCode="${room}"><RoomDescription Name="${roomName}"><Text>${roomName}</Text></RoomDescription><Occupancy AgeQualifyingCode="10" MaxOccupancy="${max}"/></RoomType></RoomTypes>` +
  `<RatePlans><RatePlan RatePlanCode="${rate}"><RatePlanDescription Name="${rateName}"><Text>${rateName}</Text></RatePlanDescription></RatePlan></RatePlans></RoomStay>`;

describe("roomsAndRatesPayload", () => {
  it("gives every room/rate combination its own RoomStay, in the shape of SiteMinder's sample", () => {
    const xml = buildResponse("HotelAvailRQ", ECHO, { success: true, payload: roomsAndRatesPayload(structure) }, NOW);
    const expected =
      `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header/><SOAP-ENV:Body>` +
      `<OTA_HotelAvailRS xmlns="http://www.opentravel.org/OTA/2003/05" EchoToken="${ECHO}" TimeStamp="2031-03-01T10:00:00Z" Version="1.0"><Success/><RoomStays>` +
      stay("SGL", "Single Room", 2, "BAR", "Single Room – Best Available Rate") +
      stay("SGL", "Single Room", 2, "NR", "Single Room – Non Refundable") +
      stay("DBL", "Double Room", 3, "BAR", "Double Room – Best Available Rate") +
      stay("DBL", "Double Room", 3, "BNB", "Double Room – Bed &amp; Breakfast") +
      `</RoomStays></OTA_HotelAvailRS></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    expect(xml).toBe(expected);
  });

  it("keeps MaxOccupancy within 1..50", () => {
    const big = { ...structure, rooms: [{ ...structure.rooms[0]!, maxAdults: 40, maxChildren: 30 }, { ...structure.rooms[1]!, maxAdults: 0, maxChildren: 0 }] };
    const stays = (roomsAndRatesPayload(big).RoomStays as { RoomStay: { RoomTypes: { RoomType: { Occupancy: Record<string, number> } } }[] }).RoomStay;
    expect(stays[0]!.RoomTypes.RoomType.Occupancy["@_MaxOccupancy"]).toBe(50);
    expect(stays[2]!.RoomTypes.RoomType.Occupancy["@_MaxOccupancy"]).toBe(1);
  });

  it("lists no RoomStay for a room without rate plans", () => {
    const empty = { ...structure, rooms: [{ ...structure.rooms[0]!, ratePlans: [] }] };
    expect(roomsAndRatesPayload(empty)).toEqual({ RoomStays: { RoomStay: [] } });
  });
});

const reg = {
  installationId: "7a1c0a52-6b1e-4b57-9f0e-2b6a4e7a9c31",
  propertyCode: "SM-RR-2031",
  propertyName: "Hotel RR",
  apiKey: "key-rr",
  coreBaseUrl: "https://core.example",
};
const inst = (): AppInstallation => ({ id: reg.installationId, propertyCode: reg.propertyCode, propertyName: reg.propertyName, apiKey: "k", coreBaseUrl: reg.coreBaseUrl, status: "active", feedCursor: null });
const failing = { structure: async () => { throw new CoreApiError("down", "network", null, true); } };
const counting = (s: AppStructure) => {
  const client = { calls: 0, structure: async () => { client.calls += 1; return s; } };
  return client;
};
const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000);

describe.skipIf(skipDbTests)("structureFor (rolled back)", () => {
  it("fetches and caches on a miss, then serves the cache for 10 minutes", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      const client = counting(structure);
      expect(await structureFor(db, inst(), client, NOW)).toEqual(structure);
      expect(await structureFor(db, inst(), client, minutes(9))).toEqual(structure);
      expect(client.calls).toBe(1);
      await structureFor(db, inst(), client, minutes(11));
      expect(client.calls).toBe(2);
    });
  });

  it("serves a stale cached copy when the refresh fails", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      await structureFor(db, inst(), counting(structure), NOW);
      expect(await structureFor(db, inst(), failing, minutes(60))).toEqual(structure);
    });
  });

  it("throws when there is no cache and core fails", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      await expect(structureFor(db, inst(), failing, NOW)).rejects.toThrow("down");
    });
  });

  it("treats a cache that no longer parses as a miss", async () => {
    await withTestDb(async (db) => {
      await upsertInstallation(db, reg);
      await db.query(`UPDATE siteminder.installations SET structure = '{"x":1}'::jsonb, structure_fetched_at = $2 WHERE id = $1`, [reg.installationId, NOW.toISOString()]);
      const client = counting(structure);
      expect(await structureFor(db, inst(), client, NOW)).toEqual(structure);
      expect(client.calls).toBe(1);
    });
  });
});

const request = (hotelCode: string, user = "sm-user", pass = "sm-pass") =>
  `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header><wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wsse:UsernameToken><wsse:Username>${user}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${pass}</wsse:Password></wsse:UsernameToken></wsse:Security></SOAP-ENV:Header><SOAP-ENV:Body>` +
  `<OTA_HotelAvailRQ xmlns="http://www.opentravel.org/OTA/2003/05" EchoToken="${ECHO}" TimeStamp="2024-07-06T15:27:41+00:00" Version="1.0" AvailRatesOnly="true"><AvailRequestSegments><AvailRequestSegment AvailReqType="Room"><HotelSearchCriteria><Criterion><HotelRef HotelCode="${hotelCode}"/></Criterion></HotelSearchCriteria></AvailRequestSegment></AvailRequestSegments></OTA_HotelAvailRQ></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const post = (app: ReturnType<typeof createApp>, body: string, headers: Record<string, string> = {}) =>
  app.request("/soap", { method: "POST", body, headers: { "Content-Type": "text/xml; charset=utf-8", ...headers } });

describe("POST /soap", () => {
  const saved: Record<string, string | undefined> = {};
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
  });
  const noDb = () => { throw new Error("db must not be touched"); };
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  afterAll(() => quiet.mockRestore());
  const deps = (client: { structure: () => Promise<AppStructure> }) => ({ now: () => NOW, clientFor: () => client });

  it("refuses an oversized body by Content-Length without reading it", async () => {
    const app = createApp(noDb, deps(failing));
    const res = await post(app, "x", { "Content-Length": String(6_000_000) });
    expect(res.status).toBe(413);
  });

  it("refuses an oversized body that is streamed with no Content-Length", async () => {
    const app = createApp(noDb, deps(failing));
    const chunk = new Uint8Array(1_000_000);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ >= 8) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const res = await app.request("/soap", { method: "POST", body, headers: { "Content-Type": "text/xml" }, duplex: "half" } as RequestInit);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(8);
  });

  it("answers a body that is no OTA message with HTTP 400 and a SOAP Fault", async () => {
    const res = await post(createApp(noDb, deps(failing)), "<nonsense/>");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("text/xml; charset=utf-8");
    expect(await res.text()).toContain("<SOAP-ENV:Fault>");
  });

  it("answers wrong credentials as an OTA error in HTTP 200", async () => {
    const res = await post(createApp(noDb, deps(failing)), request("SM-RR-2031", "sm-user", "nope"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<OTA_HotelAvailRS");
    expect(text).toContain(`<Error Type="4" Code="448">Invalid Username and/or Password</Error>`);
    expect(text).toContain(`EchoToken="${ECHO}"`);
  });

  describe.skipIf(skipDbTests)("with a database (rolled back)", () => {
    it("answers Rooms and Rates for a known hotel, as XML text/xml", async () => {
      await withTestDb(async (db) => {
        await upsertInstallation(db, reg);
        const res = await post(createApp(() => db, deps(counting(structure))), request(reg.propertyCode));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/xml; charset=utf-8");
        const text = await res.text();
        expect(text).toContain("<Success/>");
        expect(text.match(/<RoomStay>/g)).toHaveLength(4);
        expect(text).toContain(`<RatePlan RatePlanCode="BNB"><RatePlanDescription Name="Double Room – Bed &amp; Breakfast">`);
      });
    });

    it("answers an unknown HotelCode with error 392", async () => {
      await withTestDb(async (db) => {
        const res = await post(createApp(() => db, deps(failing)), request("SM-NOPE-2031"));
        expect(res.status).toBe(200);
        expect(await res.text()).toContain(`<Error Type="6" Code="392">Hotel not found for HotelCode=SM-NOPE-2031</Error>`);
      });
    });

    it("serves the stale cache when core is down, and an OTA error when there is none", async () => {
      await withTestDb(async (db) => {
        await upsertInstallation(db, reg);
        const down = await post(createApp(() => db, deps(failing)), request(reg.propertyCode));
        expect(down.status).toBe(200);
        expect(await down.text()).toContain(`<Error Type="12">Room and rate configuration is temporarily unavailable`);

        await structureFor(db, inst(), counting(structure), new Date(NOW.getTime() - 3_600_000));
        const stale = await post(createApp(() => db, deps(failing)), request(reg.propertyCode));
        expect(await stale.text()).toContain("<Success/>");
      });
    });
  });
});
