import { describe, expect, test } from "bun:test";
import type { ConsentEvent } from "./consent-events";
import { OUTBOX_KEY, enqueueConsentEvent, flushConsentOutbox, type OutboxDeps } from "./consent-outbox";

const event = (n: number): ConsentEvent => ({
  consentId: "3f2b8c1e-5d4a-4b7e-9c1a-2f6d8e0b1a34",
  eventType: "granted",
  categories: { analytics: true },
  bannerVersion: "1.1+privacy@2026-10-02/en",
  idempotencyKey: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

type Reply = number | "network";
function setup(replies: Reply[], initial?: Record<string, string>) {
  const storage = memoryStorage(initial);
  const sent: ConsentEvent[] = [];
  const dropped: Array<[string, number]> = [];
  const deps: OutboxDeps = {
    storage,
    fetch: (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      const r = replies.shift() ?? 200;
      if (r === "network") throw new TypeError("Failed to fetch");
      return Response.json(r === 200 ? { ok: true, expiresAt: "2027-01-01T00:00:00.000Z" } : {}, { status: r });
    }) as unknown as typeof fetch,
    endpoint: "/api/consent",
    onDrop: (e, status) => dropped.push([e.idempotencyKey, status]),
  };
  const queued = () => (JSON.parse(storage.data[OUTBOX_KEY] ?? "[]") as ConsentEvent[]).map((e) => e.idempotencyKey);
  return { deps, storage, sent, dropped, queued };
}

describe("consent outbox", () => {
  test("enqueue persists the event until it is delivered", () => {
    const t = setup([]);
    enqueueConsentEvent(t.deps, event(1));
    expect(t.queued()).toEqual([event(1).idempotencyKey]);
  });

  test("flush delivers oldest first and empties the queue", async () => {
    const t = setup([200, 200]);
    enqueueConsentEvent(t.deps, event(1));
    enqueueConsentEvent(t.deps, event(2));
    const result = await flushConsentOutbox(t.deps);
    expect(t.sent.map((e) => e.idempotencyKey)).toEqual([event(1).idempotencyKey, event(2).idempotencyKey]);
    expect(t.queued()).toEqual([]);
    expect(result).toEqual({ expiresAt: "2027-01-01T00:00:00.000Z", remaining: 0 });
  });

  test("a visitor with no network keeps the event for the next page load", async () => {
    const t = setup(["network"]);
    enqueueConsentEvent(t.deps, event(1));
    const result = await flushConsentOutbox(t.deps);
    expect(t.queued()).toEqual([event(1).idempotencyKey]);
    expect(result).toEqual({ expiresAt: null, remaining: 1 });
  });

  test("a rate limit or server error keeps the event and stops, preserving order", async () => {
    for (const status of [429, 500, 503]) {
      const t = setup([status]);
      enqueueConsentEvent(t.deps, event(1));
      enqueueConsentEvent(t.deps, event(2));
      await flushConsentOutbox(t.deps);
      expect(t.sent.length).toBe(1);
      expect(t.queued()).toEqual([event(1).idempotencyKey, event(2).idempotencyKey]);
    }
  });

  test("a rejected event is dropped and reported, and the rest still go", async () => {
    const t = setup([400, 200]);
    enqueueConsentEvent(t.deps, event(1));
    enqueueConsentEvent(t.deps, event(2));
    await flushConsentOutbox(t.deps);
    expect(t.dropped).toEqual([[event(1).idempotencyKey, 400]]);
    expect(t.queued()).toEqual([]);
  });

  test("keeps at most 20 events, dropping the oldest", () => {
    const t = setup([]);
    for (let i = 1; i <= 25; i++) enqueueConsentEvent(t.deps, event(i));
    expect(t.queued().length).toBe(20);
    expect(t.queued()[0]).toBe(event(6).idempotencyKey);
  });

  test("corrupt stored data is treated as an empty queue", async () => {
    const t = setup([200], { [OUTBOX_KEY]: "{not json" });
    expect(await flushConsentOutbox(t.deps)).toEqual({ expiresAt: null, remaining: 0 });
    enqueueConsentEvent(t.deps, event(1));
    expect(t.queued()).toEqual([event(1).idempotencyKey]);
  });

  test("storage that throws never breaks the page", async () => {
    const deps: OutboxDeps = {
      storage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
      fetch: (async () => Response.json({})) as unknown as typeof fetch,
      endpoint: "/api/consent",
    };
    expect(() => enqueueConsentEvent(deps, event(1))).not.toThrow();
    expect(await flushConsentOutbox(deps)).toEqual({ expiresAt: null, remaining: 0 });
  });

  test("two flushes at once do not send the same event twice", async () => {
    const t = setup([200, 200]);
    enqueueConsentEvent(t.deps, event(1));
    await Promise.all([flushConsentOutbox(t.deps), flushConsentOutbox(t.deps)]);
    expect(t.sent.length).toBe(1);
  });

  test("sends JSON to the endpoint without credentials being stripped", async () => {
    const t = setup([200]);
    let seen: RequestInit | undefined;
    const inner = t.deps.fetch;
    t.deps.fetch = ((url: string, init: RequestInit) => {
      seen = init;
      return inner(url, init);
    }) as unknown as typeof fetch;
    enqueueConsentEvent(t.deps, event(1));
    await flushConsentOutbox(t.deps);
    expect(seen?.method).toBe("POST");
    expect((seen?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(seen?.credentials).toBe("same-origin");
  });
});
