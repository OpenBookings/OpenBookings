import { describe, expect, it } from "bun:test";
import type { AriBatch, DeliveryReport } from "@openbookings/apps-contract";
import { CoreApiError, UnknownBookingError, coreClient } from "./core-client";
import type { AppInstallation } from "./installations";

const inst: AppInstallation = {
  id: "5f1c0a52-6b1e-4b57-9f0e-2b6a4e7a9c01",
  propertyCode: "SM-TEST-2031",
  propertyName: "Hotel",
  apiKey: "key-123",
  coreBaseUrl: "https://core.example/",
  status: "active",
  feedCursor: null,
};

type Seen = { url: string; init: RequestInit };
function fake(status: number, body?: unknown): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

const batch: AriBatch = { inventory: [], rates: [], restrictions: [] };
const report: DeliveryReport = { status: "delivered", acknowledgedAt: "2031-01-01T10:00:00Z", detail: null, version: 1 };
const structure = {
  propertyCode: "P", propertyName: "N", timezone: "Europe/Amsterdam",
  rooms: [{ code: "R", name: "R", baseOccupancy: 2, maxAdults: 3, maxChildren: 1, ratePlans: [{ code: "BAR", name: "Bar", isRefundable: true, includesBreakfast: false, includesLunch: false, includesDinner: false }] }],
};

async function failure(p: Promise<unknown>): Promise<CoreApiError> {
  try {
    await p;
  } catch (e) {
    return e as CoreApiError;
  }
  throw new Error("expected a rejection");
}

describe("coreClient", () => {
  it("sends the bearer key to the joined URL (trailing slash stripped) with a timeout", async () => {
    const { fetchImpl, seen } = fake(200, structure);
    const s = await coreClient(inst, fetchImpl).structure();
    expect(s.propertyCode).toBe("P");
    expect(seen[0]!.url).toBe("https://core.example/api/apps/v1/structure");
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer key-123");
    expect(seen[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on a malformed core reply", async () => {
    const { fetchImpl } = fake(200, { nope: true });
    const e = await failure(coreClient(inst, fetchImpl).structure());
    expect(e).toBeInstanceOf(CoreApiError);
    expect(e.kind).toBe("invalid_response");
    expect(e.retryable).toBe(false);
  });

  it("writeAri posts the batch and returns the result for 200 and 422", async () => {
    const ok = fake(200, { ok: true, nights: 3 });
    expect(await coreClient(inst, ok.fetchImpl).writeAri(batch)).toEqual({ ok: true, nights: 3 });
    expect(ok.seen[0]!.init.method).toBe("POST");
    expect(JSON.parse(ok.seen[0]!.init.body as string)).toEqual(batch);
    const unknown = { ok: false as const, error: "unknown codes", unknownCodes: ["X"] };
    expect(await coreClient(inst, fake(422, unknown).fetchImpl).writeAri(batch)).toEqual(unknown);
  });

  it("classifies errors as retryable or permanent", async () => {
    const cases: [number, boolean, string][] = [
      [400, false, "bad_request"],
      [401, false, "unauthorized"],
      [413, false, "too_large"],
      [500, true, "server"],
      [502, true, "server"],
      [503, true, "unavailable"],
      [408, true, "unavailable"],
      [429, true, "unavailable"],
    ];
    for (const [status, retryable, kind] of cases) {
      const e = await failure(coreClient(inst, fake(status, { error: "x" }).fetchImpl).writeAri(batch));
      expect(`${e.status}/${e.retryable}/${e.kind}`).toBe(`${status}/${retryable}/${kind}`);
    }
  });

  it("treats network errors and timeouts as retryable", async () => {
    const boom = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const e = await failure(coreClient(inst, boom).changes(null));
    expect(`${e.kind}/${e.retryable}/${e.status}`).toBe("network/true/null");
  });

  it("a body that stops arriving (timeout, abort, dropped connection) is a retryable network failure", async () => {
    const stalled = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new DOMException("The operation timed out.", "TimeoutError"));
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const e = await failure(coreClient(inst, stalled).writeAri(batch));
    expect(`${e.kind}/${e.retryable}`).toBe("network/true");
  });

  it("a complete body that is not JSON is an invalid response", async () => {
    const html = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    const e = await failure(coreClient(inst, html).writeAri(batch));
    expect(`${e.kind}/${e.retryable}`).toBe("invalid_response/false");
  });

  it("changes sends cursor and limit, and validates the page", async () => {
    const page = { bookings: [], nextCursor: "c2", hasMore: false };
    const { fetchImpl, seen } = fake(200, page);
    expect(await coreClient(inst, fetchImpl).changes("c 1", 50)).toEqual(page);
    expect(seen[0]!.url).toBe("https://core.example/api/apps/v1/bookings/changes?cursor=c+1&limit=50");
    const none = fake(200, page);
    await coreClient(inst, none.fetchImpl).changes(null);
    expect(none.seen[0]!.url).toBe("https://core.example/api/apps/v1/bookings/changes");
  });

  it("reportDelivery PUTs the report; 204 resolves, 404 is a distinct permanent error", async () => {
    const ok = fake(204);
    await coreClient(inst, ok.fetchImpl).reportDelivery("b-1", report);
    expect(ok.seen[0]!.url).toBe("https://core.example/api/apps/v1/bookings/b-1/delivery");
    expect(ok.seen[0]!.init.method).toBe("PUT");
    const e = await failure(coreClient(inst, fake(404, { error: "x" }).fetchImpl).reportDelivery("b-1", report));
    expect(e).toBeInstanceOf(UnknownBookingError);
    expect(e.retryable).toBe(false);
    const bad = await failure(coreClient(inst, fake(400, {}).fetchImpl).reportDelivery("b-1", report));
    expect(bad).not.toBeInstanceOf(UnknownBookingError);
    expect(bad.retryable).toBe(false);
  });
});
