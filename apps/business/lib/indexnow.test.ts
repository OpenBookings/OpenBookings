import { describe, expect, test } from "bun:test";
import { notifyIndexNow } from "./indexnow";

const KEY = "indexnow-test-key";

function recordingFetch(status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("notifyIndexNow", () => {
  test("sends the page with the key and where to verify it", async () => {
    const { fetch, calls } = recordingFetch(202);
    await notifyIndexNow("https://openbookings.co/", "/p/a", KEY, { fetch, sent: new Map() });
    expect(calls).toEqual([
      {
        url: "https://api.indexnow.org/indexnow",
        body: {
          host: "openbookings.co",
          key: KEY,
          keyLocation: "https://openbookings.co/indexnow-key.txt",
          urlList: ["https://openbookings.co/p/a"],
        },
      },
    ]);
  });

  test("does nothing without a valid key or a public https site", async () => {
    const { fetch, calls } = recordingFetch();
    const deps = { fetch, sent: new Map<string, number>() };
    await notifyIndexNow("https://openbookings.co", "/p/a", undefined, deps);
    await notifyIndexNow("https://openbookings.co", "/p/a", "short", deps);
    await notifyIndexNow("https://openbookings.co", "/p/a", "has spaces in it", deps);
    await notifyIndexNow("http://openbookings.co", "/p/a", KEY, deps);
    await notifyIndexNow("https://web.localhost:3002", "/p/a", KEY, deps);
    await notifyIndexNow("not a url", "/p/a", KEY, deps);
    expect(calls).toEqual([]);
  });

  test("sends a page at most once an hour", async () => {
    const { fetch, calls } = recordingFetch();
    let now = 0;
    const deps = { fetch, sent: new Map<string, number>(), now: () => now };
    await notifyIndexNow("https://openbookings.co", "/p/a", KEY, deps);
    now = 59 * 60 * 1000;
    await notifyIndexNow("https://openbookings.co", "/p/a", KEY, deps);
    await notifyIndexNow("https://openbookings.co", "/p/b", KEY, deps);
    now = 61 * 60 * 1000;
    await notifyIndexNow("https://openbookings.co", "/p/a", KEY, deps);
    expect(calls.map((c) => (c.body as { urlList: string[] }).urlList[0])).toEqual([
      "https://openbookings.co/p/a",
      "https://openbookings.co/p/b",
      "https://openbookings.co/p/a",
    ]);
  });

  test("a refused ping throws and is retried on the next save", async () => {
    const failing = recordingFetch(429);
    const sent = new Map<string, number>();
    await expect(notifyIndexNow("https://openbookings.co", "/p/a", KEY, { fetch: failing.fetch, sent })).rejects.toThrow("429");
    const ok = recordingFetch();
    await notifyIndexNow("https://openbookings.co", "/p/a", KEY, { fetch: ok.fetch, sent });
    expect(ok.calls).toHaveLength(1);
  });
});
