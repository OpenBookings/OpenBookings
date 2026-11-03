import { describe, expect, test } from "bun:test";
import { isValidSlug, slugCandidates, toSlug } from "./slug";

describe("toSlug", () => {
  test("lowercases and hyphenates", () => {
    expect(toSlug("Grand Hotel Amsterdam")).toBe("grand-hotel-amsterdam");
  });

  test("strips accents rather than dropping the letters", () => {
    expect(toSlug("Hôtel Crémieux")).toBe("hotel-cremieux");
    expect(toSlug("Château d'Æther")).toBe("chateau-daether");
  });

  test("collapses runs of separators", () => {
    expect(toSlug("The  Grand --- Hotel")).toBe("the-grand-hotel");
  });

  test("trims leading and trailing separators", () => {
    expect(toSlug("  ...Grand Hotel!  ")).toBe("grand-hotel");
  });

  test("keeps digits", () => {
    expect(toSlug("Hotel 21")).toBe("hotel-21");
  });

  test("falls back for input with nothing slug-able in it", () => {
    expect(toSlug("!!!")).toBe("property");
    expect(toSlug("")).toBe("property");
    expect(toSlug("日本語")).toBe("property");
  });

  test("caps length so it fits the varchar(255) column", () => {
    expect(toSlug("a".repeat(400)).length).toBe(200);
  });

  test("never ends on a hyphen after truncation", () => {
    expect(toSlug(`${"a".repeat(199)} b`).endsWith("-")).toBe(false);
  });

  test("folds ligatures and stroked letters instead of destroying them", () => {
    expect(toSlug("Ærøskøbing Kro")).toBe("aeroskobing-kro");
    expect(toSlug("Straße")).toBe("strasse");
    expect(toSlug("Þingvellir")).toBe("thingvellir");
    expect(toSlug("Œuvre Hotel")).toBe("oeuvre-hotel");
  });

  test("elides apostrophes rather than turning them into separators", () => {
    expect(toSlug("O\u0027Brien\u0027s Inn")).toBe("obriens-inn");
    expect(toSlug("O\u2019Brien\u2019s Inn")).toBe("obriens-inn");
    expect(toSlug("O\u2018Brien\u2018s Inn")).toBe("obriens-inn");
    expect(toSlug("O\u02bcBrien\u02bcs Inn")).toBe("obriens-inn");
  });
});

describe("slugCandidates", () => {
  test("offers the bare slug first", () => {
    expect(slugCandidates("grand-hotel")[0]).toBe("grand-hotel");
  });

  test("suffixes from 2 upward, because 'grand-hotel-1' reads like a typo", () => {
    expect(slugCandidates("grand-hotel").slice(0, 3)).toEqual([
      "grand-hotel",
      "grand-hotel-2",
      "grand-hotel-3",
    ]);
  });

  test("is bounded so a pathological collision cannot loop forever", () => {
    expect(slugCandidates("x").length).toBe(20);
    expect(slugCandidates("x", 5).length).toBe(5);
  });
});

describe("isValidSlug", () => {
  test("accepts what toSlug and slugCandidates produce", () => {
    for (const name of ["Grand Hotel", "Hôtel Crémieux", "O'Brien's Inn", "Ærøskøbing Kro", "漢字 only"]) {
      expect(isValidSlug(toSlug(name))).toBe(true);
      for (const candidate of slugCandidates(toSlug(name)).slice(0, 5)) expect(isValidSlug(candidate)).toBe(true);
    }
  });

  test("rejects anything that could change a URL", () => {
    for (const bad of ["", "../x", "a/b", "a?b", "a#b", "a b", "A", "a_b", "-a", "a-", "a--b", "a.b", "a%2fb", "x".repeat(256), null, 5]) {
      expect(isValidSlug(bad)).toBe(false);
    }
  });
});
