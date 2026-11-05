import { afterEach, describe, expect, spyOn, test } from "bun:test";
import bundled from "../manifest.json";
import { parseBackdropManifest } from "./backdrops";
import { getBackdrops } from "./server";

const realFetch = globalThis.fetch;
const bundledList = parseBackdropManifest(bundled);

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(impl: () => Promise<Response>) {
  globalThis.fetch = impl as unknown as typeof fetch;
}

describe("getBackdrops", () => {
  test("uses the CDN manifest when it loads", async () => {
    const live = { backdrops: [{ id: "italy-rome", name: "Rome", file: "Italy-Rome.avif" }] };
    stubFetch(async () => Response.json(live));
    expect(await getBackdrops()).toEqual(parseBackdropManifest(live));
  });

  // The homepage is prerendered at build time. An empty list there gets baked
  // into the cached page: no photo and a bare "Discover" heading.
  test.each([
    ["the CDN errors", async () => new Response("blocked", { status: 403 })],
    ["the request fails", async () => Promise.reject(new TypeError("fetch failed"))],
    ["the manifest is not JSON", async () => new Response("<html>challenge</html>")],
    ["the manifest is empty", async () => Response.json({ backdrops: [] })],
  ])("falls back to the bundled manifest when %s", async (_, impl) => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(impl);
    const list = await getBackdrops();
    expect(bundledList.length).toBeGreaterThan(0);
    expect(list).toEqual(bundledList);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
