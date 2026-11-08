import { describe, expect, test } from "bun:test";
import { checkVatId, normaliseVatId, ViesUnavailableError } from "./vies";

const requester = { countryCode: "NL" as const, vatNumber: "123456789B01" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake fetch that plays back the given responses (or throws an Error) in order. */
function fakeFetch(...steps: (Response | Error)[]) {
  const calls: { url: string; body: Record<string, string> }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step.clone();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const sleeps: number[] = [];
const sleep = async (ms: number) => {
  sleeps.push(ms);
};
const valid = { valid: true, requestIdentifier: "WAPIAAAAZZZ", actionSucceed: true };

describe("normaliseVatId", () => {
  test("compacts a formatted id into country and number", () => {
    expect(normaliseVatId("BE 0123.456.789")).toEqual({ countryCode: "BE", vatNumber: "0123456789" });
    expect(normaliseVatId("nl-123456789b01")).toEqual({ countryCode: "NL", vatNumber: "123456789B01" });
  });

  test("uses EL for Greece, whether the id says GR or EL", () => {
    expect(normaliseVatId("GR123456789")).toEqual({ countryCode: "EL", vatNumber: "123456789" });
    expect(normaliseVatId("EL 123456789")).toEqual({ countryCode: "EL", vatNumber: "123456789" });
  });
});

describe("checkVatId", () => {
  test("a valid answer carries the request identifier", async () => {
    const { fn, calls } = fakeFetch(json(valid));
    const r = await checkVatId("BE 0123.456.789", { fetch: fn, sleep, requester });
    expect(r.valid).toBe(true);
    expect(r.requestId).toBe("WAPIAAAAZZZ");
    expect(r.checkedAt).toBeInstanceOf(Date);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number");
    expect(calls[0].body).toEqual({
      countryCode: "BE",
      vatNumber: "0123456789",
      requesterMemberStateCode: "NL",
      requesterNumber: "123456789B01",
    });
  });

  test("an invalid answer is a result, not an error", async () => {
    const { fn } = fakeFetch(json({ valid: false, actionSucceed: true }));
    const r = await checkVatId("DE123456789", { fetch: fn, sleep, requester });
    expect(r.valid).toBe(false);
    expect(r.requestId).toBeNull();
  });

  test("asks VIES for Greece as EL", async () => {
    const { fn, calls } = fakeFetch(json(valid));
    await checkVatId("GR123456789", { fetch: fn, sleep, requester });
    expect(calls[0].body.countryCode).toBe("EL");
  });

  test("retries MS_UNAVAILABLE and succeeds on the third call", async () => {
    sleeps.length = 0;
    const down = json({ actionSucceed: false, errorWrappers: [{ error: "MS_UNAVAILABLE" }] });
    const { fn, calls } = fakeFetch(down, down, json(valid));
    const r = await checkVatId("BE0123456789", { fetch: fn, sleep, requester });
    expect(r.valid).toBe(true);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 4000]);
  });

  test("retries a network error", async () => {
    const { fn, calls } = fakeFetch(new TypeError("fetch failed"), json(valid));
    expect((await checkVatId("BE0123456789", { fetch: fn, sleep, requester })).valid).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("gives up with ViesUnavailableError after 4 calls on 503", async () => {
    sleeps.length = 0;
    const { fn, calls } = fakeFetch(new Response("down", { status: 503 }));
    await expect(checkVatId("BE0123456789", { fetch: fn, sleep, requester })).rejects.toBeInstanceOf(
      ViesUnavailableError,
    );
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 4000, 16000]);
  });

  test("INVALID_INPUT means invalid and is not retried", async () => {
    const { fn, calls } = fakeFetch(
      json({ actionSucceed: false, errorWrappers: [{ error: "INVALID_INPUT" }] }, 400),
    );
    const r = await checkVatId("BE0123456789", { fetch: fn, sleep, requester });
    expect(r.valid).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("a valid:false carrying a busy member state error is retried, not final", async () => {
    const busy = json({ valid: false, userError: "MS_UNAVAILABLE" });
    const { fn, calls } = fakeFetch(busy, json(valid));
    const r = await checkVatId("BE0123456789", { fetch: fn, sleep, requester });
    expect(r.valid).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("a call that hangs is aborted, retried and finally reported unavailable", async () => {
    let calls = 0;
    const hanging = ((_url: string, init?: RequestInit) => {
      calls++;
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as unknown as typeof fetch;
    await expect(
      checkVatId("BE0123456789", { fetch: hanging, sleep, requester, timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(ViesUnavailableError);
    expect(calls).toBe(4);
  });
});
