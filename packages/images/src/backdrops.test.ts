import { describe, expect, test } from "bun:test";
import { BACKDROPS, resolveBackdrop } from "./backdrops";

const first = () => 0;

describe("BACKDROPS", () => {
  test("every entry has a name and a CDN url", () => {
    expect(BACKDROPS.length).toBeGreaterThan(0);
    for (const b of BACKDROPS) {
      expect(b.name).not.toBe("");
      expect(b.url.startsWith("https://cdn.openbookings.co/Public/backgrounds/")).toBe(true);
    }
  });
});

describe("resolveBackdrop", () => {
  test("picks one and reports a change when nothing is stored", () => {
    expect(resolveBackdrop(null, first)).toEqual({ backdrop: BACKDROPS[0], changed: true });
  });

  test("keeps a stored backdrop that is still in the list", () => {
    const stored = JSON.stringify(BACKDROPS[1]);
    expect(resolveBackdrop(stored, first)).toEqual({ backdrop: BACKDROPS[1], changed: false });
  });

  test("replaces a stored backdrop whose file has since been renamed", () => {
    const stale = JSON.stringify({ url: "https://cdn.openbookings.co/Public/backgrounds/Gone.avif", name: "Gone" });
    expect(resolveBackdrop(stale, first)).toEqual({ backdrop: BACKDROPS[0], changed: true });
  });

  test.each(["not json", "null", "42", "{}", '{"url":5,"name":"x"}'])(
    "replaces unusable stored value %p",
    (stored) => {
      expect(resolveBackdrop(stored, first)).toEqual({ backdrop: BACKDROPS[0], changed: true });
    },
  );

  test("a random value of just under 1 selects the last entry, not past the end", () => {
    const { backdrop } = resolveBackdrop(null, () => 0.999999);
    expect(backdrop).toEqual(BACKDROPS[BACKDROPS.length - 1]);
  });
});
