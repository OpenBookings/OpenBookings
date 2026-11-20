import { describe, expect, test } from "bun:test";
import { resolveMapStyles, tomtomSearchUrl, tomtomStyleUrl } from "./index";

describe("tomtomStyleUrl", () => {
  test("builds the Orbis style URL per theme", () => {
    expect(tomtomStyleUrl("light", "key-1")).toBe(
      "https://api.tomtom.com/maps/orbis/assets/styles/2.*/style?apiVersion=1&key=key-1&map=basic_street-light",
    );
    expect(tomtomStyleUrl("dark", "key-1")).toEndWith("&map=basic_street-dark");
  });

  test("returns null without a key; empty and whitespace count as missing", () => {
    expect(tomtomStyleUrl("light", undefined)).toBeNull();
    expect(tomtomStyleUrl("light", "")).toBeNull();
    expect(tomtomStyleUrl("light", "   ")).toBeNull();
  });

  test("encodes the key so a stray character cannot break the URL", () => {
    expect(tomtomStyleUrl("light", "k&x=1")).toContain("key=k%26x%3D1&");
  });
});

describe("resolveMapStyles", () => {
  const fallback = { light: "L", dark: "D" };

  test("uses the per-theme fallback when the caller passes nothing", () => {
    expect(resolveMapStyles(undefined, fallback)).toEqual({ light: "L", dark: "D" });
  });

  test("a caller's style wins over the fallback, per theme", () => {
    expect(resolveMapStyles({ light: "mine" }, fallback)).toEqual({ light: "mine", dark: "D" });
  });

  test("is null when one theme has no style, so no map is built for half a configuration", () => {
    expect(resolveMapStyles({ light: "mine" }, null)).toBeNull();
  });

  test("is null when nothing is configured at all", () => {
    expect(resolveMapStyles(undefined, null)).toBeNull();
  });

  test("an empty string from a caller counts as missing, not as a style", () => {
    expect(resolveMapStyles({ light: "", dark: "mine" }, null)).toBeNull();
    expect(resolveMapStyles({ light: "" }, fallback)).toEqual({ light: "L", dark: "D" });
  });

  test("passes style objects through untouched", () => {
    const spec = { version: 8 as const, sources: {}, layers: [] };
    expect(resolveMapStyles({ light: spec, dark: spec }, null)).toEqual({ light: spec, dark: spec });
  });
});

describe("tomtomSearchUrl", () => {
  test("builds a fuzzy search URL with the given filters", () => {
    expect(tomtomSearchUrl("Dam 1", "key-1", { idxSet: "PAD,Addr", countrySet: "NL,BE", limit: 5 })).toBe(
      "https://api.tomtom.com/search/2/search/Dam%201.json?key=key-1&idxSet=PAD%2CAddr&countrySet=NL%2CBE&limit=5",
    );
  });

  test("adds a position bias when given", () => {
    expect(
      tomtomSearchUrl("x", "k", { idxSet: "POI", countrySet: "IT", limit: 5, lat: 42.5, lon: 11.4 }),
    ).toEndWith("&lat=42.5&lon=11.4");
  });

  test("encodes the query, including a slash", () => {
    expect(tomtomSearchUrl("a/b", "k", { idxSet: "POI", countrySet: "IT", limit: 1 })).toStartWith(
      "https://api.tomtom.com/search/2/search/a%2Fb.json?",
    );
  });

  test("is null without a key, so no request is sent that can only fail", () => {
    expect(tomtomSearchUrl("Dam 1", undefined, { idxSet: "PAD", countrySet: "NL", limit: 5 })).toBeNull();
    expect(tomtomSearchUrl("Dam 1", " ", { idxSet: "PAD", countrySet: "NL", limit: 5 })).toBeNull();
  });
});
