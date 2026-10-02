import { describe, expect, test } from "bun:test";
import { maptilerStyleUrl } from "./map-style";

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
