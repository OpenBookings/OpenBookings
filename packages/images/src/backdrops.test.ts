import { describe, expect, test } from "bun:test";
import { parseBackdropManifest, pickBackdrop, type Backdrop } from "./backdrops";

const BASE = "https://cdn.openbookings.co/Public/backgrounds";
const first = () => 0;

describe("parseBackdropManifest", () => {
  test("builds CDN urls from valid entries", () => {
    const list = parseBackdropManifest({
      backdrops: [
        { id: "italy-rome", name: "Rome", file: "Italy-Rome.avif" },
        { id: "usa-nyc", name: " New York City ", file: "USA New York.avif" },
      ],
    });
    expect(list).toEqual([
      { id: "italy-rome", name: "Rome", url: `${BASE}/Italy-Rome.avif` },
      { id: "usa-nyc", name: "New York City", url: `${BASE}/USA%20New%20York.avif` },
    ]);
  });

  test.each([[null], [42], ["x"], [{}], [{ backdrops: "nope" }], [[]]])("returns nothing for %p", (json) => {
    expect(parseBackdropManifest(json)).toEqual([]);
  });

  test("drops malformed entries and keeps the rest", () => {
    const list = parseBackdropManifest({
      backdrops: [
        null,
        { id: "Bad Id", name: "x", file: "a.avif" },
        { id: "no-name", name: "  ", file: "a.avif" },
        { id: "no-file", name: "x" },
        { id: "ok", name: "Ok", file: "ok.avif" },
      ],
    });
    expect(list.map((b) => b.id)).toEqual(["ok"]);
  });

  test.each(["../secret.json", "nested/file.avif", "back\\slash.avif", ""])("rejects file %p", (file) => {
    expect(parseBackdropManifest({ backdrops: [{ id: "x", name: "X", file }] })).toEqual([]);
  });

  test("keeps the first entry when ids repeat", () => {
    const list = parseBackdropManifest({
      backdrops: [
        { id: "iceland", name: "Reykjavik", file: "a.avif" },
        { id: "iceland", name: "Waterfall", file: "b.avif" },
      ],
    });
    expect(list).toEqual([{ id: "iceland", name: "Reykjavik", url: `${BASE}/a.avif` }]);
  });
});

describe("pickBackdrop", () => {
  const list: Backdrop[] = [
    { id: "a", name: "A", url: `${BASE}/a.avif` },
    { id: "b", name: "B", url: `${BASE}/b.avif` },
    { id: "c", name: "C", url: `${BASE}/c.avif` },
  ];

  test("keeps a remembered id that is still in the list", () => {
    expect(pickBackdrop(list, "b", first)).toEqual({ backdrop: list[1], persist: false });
  });

  test.each([undefined, null, "", "gone"])("picks a new one for stored id %p", (stored) => {
    expect(pickBackdrop(list, stored, first)).toEqual({ backdrop: list[0], persist: true });
  });

  test("a random value of just under 1 selects the last entry, not past the end", () => {
    expect(pickBackdrop(list, null, () => 0.999999).backdrop).toEqual(list[2]);
  });

  test("an empty list gives no backdrop and nothing to remember", () => {
    expect(pickBackdrop([], "a", first)).toEqual({ backdrop: null, persist: false });
  });
});
