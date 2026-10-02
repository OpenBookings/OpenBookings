import { describe, expect, test } from "bun:test";
import { maptilerGeocodingUrl, maptilerStyleUrl, resolveMapStyles } from "./index";

describe("maptilerStyleUrl", () => {
  test("builds the MapTiler style URL from id and key", () => {
    expect(maptilerStyleUrl("style-1", "key-1")).toBe(
      "https://api.maptiler.com/maps/style-1/style.json?key=key-1",
    );
  });

  test("returns null when the style id is missing", () => {
    expect(maptilerStyleUrl(undefined, "key-1")).toBeNull();
  });

  test("returns null when the key is missing", () => {
    expect(maptilerStyleUrl("style-1", undefined)).toBeNull();
  });

  test("treats empty and whitespace values as missing", () => {
    expect(maptilerStyleUrl("", "key-1")).toBeNull();
    expect(maptilerStyleUrl("style-1", "   ")).toBeNull();
  });

  test("encodes values so a stray character cannot break the URL", () => {
    expect(maptilerStyleUrl("a/b", "k&x=1")).toBe(
      "https://api.maptiler.com/maps/a%2Fb/style.json?key=k%26x%3D1",
    );
  });
});

describe("resolveMapStyles", () => {
  test("uses the fallback for both themes when the caller passes nothing", () => {
    expect(resolveMapStyles(undefined, "default")).toEqual({ light: "default", dark: "default" });
  });

  test("a caller's style wins over the fallback, per theme", () => {
    expect(resolveMapStyles({ light: "mine" }, "default")).toEqual({ light: "mine", dark: "default" });
  });

  test("is null when one theme has no style, so no map is built for half a configuration", () => {
    expect(resolveMapStyles({ light: "mine" }, null)).toBeNull();
  });

  test("is null when nothing is configured at all", () => {
    expect(resolveMapStyles(undefined, null)).toBeNull();
  });

  test("an empty string from a caller counts as missing, not as a style", () => {
    expect(resolveMapStyles({ light: "", dark: "mine" }, null)).toBeNull();
    expect(resolveMapStyles({ light: "" }, "default")).toEqual({ light: "default", dark: "default" });
  });

  test("passes style objects through untouched", () => {
    const spec = { version: 8 as const, sources: {}, layers: [] };
    expect(resolveMapStyles({ light: spec, dark: spec }, null)).toEqual({ light: spec, dark: spec });
  });
});

describe("maptilerGeocodingUrl", () => {
  test("builds the address search URL", () => {
    expect(maptilerGeocodingUrl("Dam 1", "key-1")).toBe(
      "https://api.maptiler.com/geocoding/Dam%201.json?key=key-1&types=address&limit=5&language=en",
    );
  });

  test("is null without a key, so no request is sent that can only fail", () => {
    expect(maptilerGeocodingUrl("Dam 1", undefined)).toBeNull();
    expect(maptilerGeocodingUrl("Dam 1", "  ")).toBeNull();
  });
});
