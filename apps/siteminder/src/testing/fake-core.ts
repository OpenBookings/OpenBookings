import { type AppStructure, type AriBatch, AriBatchSchema } from "@openbookings/apps-contract";

/** What the fake core was sent: one entry per accepted `POST /api/apps/v1/ari`. */
export type ReceivedAri = { at: string; batch: AriBatch; nights: number };

export type FakeCore = {
  url: string;
  received: ReceivedAri[];
  stop: () => void;
};

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const nightsOf = (c: { from: string; to: string }) => dayNumber(c.to) - dayNumber(c.from) + 1;

/** Two rooms, two rate plans each: enough for every SiteMinder sample's SGL/BAR/BNB codes. */
export function fakeStructure(propertyCode: string): AppStructure {
  const plans = [
    { code: "BAR", name: "Best available rate", isRefundable: true, includesBreakfast: false, includesLunch: false, includesDinner: false },
    { code: "BNB", name: "Bed and breakfast", isRefundable: true, includesBreakfast: true, includesLunch: false, includesDinner: false },
  ];
  return {
    propertyCode,
    propertyName: "Fake Core Hotel",
    timezone: "Europe/Amsterdam",
    rooms: [
      { code: "SGL", name: "Single room", baseOccupancy: 1, maxAdults: 1, maxChildren: 0, ratePlans: plans },
      { code: "DBL", name: "Double room", baseOccupancy: 2, maxAdults: 2, maxChildren: 1, ratePlans: plans },
    ],
  };
}

/**
 * A stand-in for core's Apps API for local runs (dev-with-fake-core, replay). It answers `GET /structure` and
 * `POST /ari` and records what arrived; `GET /_received` (not part of the Apps API) returns the totals.
 * It checks the batch against the contract schema, so a malformed batch is a 400 as in core. No auth.
 */
export function startFakeCore(opts: { port?: number; propertyCode: string }): FakeCore {
  const received: ReceivedAri[] = [];
  const server = Bun.serve({
    port: opts.port ?? 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method === "GET" && pathname === "/api/apps/v1/structure") return Response.json(fakeStructure(opts.propertyCode));
      if (req.method === "POST" && pathname === "/api/apps/v1/ari") {
        const parsed = AriBatchSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "invalid batch" }, { status: 400 });
        const { inventory, rates, restrictions } = parsed.data;
        const nights = [...inventory, ...rates, ...restrictions].reduce((n, c) => n + nightsOf(c), 0);
        received.push({ at: new Date().toISOString(), batch: parsed.data, nights });
        return Response.json({ ok: true, nights });
      }
      if (req.method === "GET" && pathname === "/_received") {
        return Response.json({
          batches: received.length,
          inventory: received.reduce((n, r) => n + r.batch.inventory.length, 0),
          rates: received.reduce((n, r) => n + r.batch.rates.length, 0),
          restrictions: received.reduce((n, r) => n + r.batch.restrictions.length, 0),
          nights: received.reduce((n, r) => n + r.nights, 0),
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  return { url: `http://localhost:${server.port}`, received, stop: () => void server.stop(true) };
}

if (import.meta.main) {
  const core = startFakeCore({ port: Number(process.env.FAKE_CORE_PORT ?? 4010), propertyCode: process.env.FAKE_CORE_HOTEL ?? "FAKE-HOTEL" });
  console.log(`fake core on ${core.url}`);
}
