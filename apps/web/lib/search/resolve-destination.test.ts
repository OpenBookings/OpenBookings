import { describe, expect, test } from "bun:test";
import { resolveDestination, type CityHit } from "./resolve-destination";

const passThrough = <T>(_key: string, load: () => Promise<T | null>) => load();
const hit = (o: Partial<CityHit> & { city: string }): CityHit => ({
  lat: 1, lng: 2, country: "France", iso2: "FR", population: 1000, ...o,
});
const searching = (hits: CityHit[]) => async () => hits;

describe("resolveDestination", () => {
  const paris = hit({ city: "Paris", lat: 48.85, lng: 2.35, population: 2_100_000 });
  const parisCa = hit({ city: "Paris", country: "Canada", iso2: "CA", lat: 43.2, lng: -80.4, population: 9_000_000 });

  test("city + country picks the matching country, not a larger Paris elsewhere", async () => {
    const r = await resolveDestination("Paris, France", { search: searching([parisCa, paris]), cache: passThrough });
    expect(r).toEqual({ lat: 48.85, lon: 2.35, city: "Paris", country: "France" });
  });

  test("city alone picks the most populous EU exact match", async () => {
    const small = hit({ city: "Paris", country: "Spain", iso2: "ES", population: 10 });
    const r = await resolveDestination("paris", { search: searching([parisCa, small, paris]), cache: passThrough });
    expect(r?.country).toBe("France");
  });

  test("matches diacritics-insensitively and via city_ascii", async () => {
    const r = await resolveDestination("Zurich", {
      search: searching([hit({ city: "Zürich", city_ascii: "Zurich", country: "Switzerland", iso2: "CH" }), hit({ city: "Zürich", city_ascii: "Zurich", country: "Germany", iso2: "DE" })]),
      cache: passThrough,
    });
    expect(r?.country).toBe("Germany");
  });

  test("falls back to the first EU hit when no exact name matches", async () => {
    const r = await resolveDestination("Pari", { search: searching([hit({ city: "Pariser", lat: 5, lng: 6 })]), cache: passThrough });
    expect(r?.lat).toBe(5);
  });

  test("a non-EU-only result is null", async () => {
    expect(await resolveDestination("Paris", { search: searching([parisCa]), cache: passThrough })).toBeNull();
  });

  test("unknown and empty are null", async () => {
    expect(await resolveDestination("Nowhereville", { search: searching([]), cache: passThrough })).toBeNull();
    expect(await resolveDestination("   ", { search: async () => { throw new Error("no"); }, cache: passThrough })).toBeNull();
  });

  test("a throwing search is null", async () => {
    const r = await resolveDestination("Paris", { search: async () => { throw new Error("down"); }, cache: passThrough });
    expect(r).toBeNull();
  });

  test("non-finite coordinates are skipped", async () => {
    const r = await resolveDestination("Paris", { search: searching([hit({ city: "Paris", lat: NaN })]), cache: passThrough });
    expect(r).toBeNull();
  });

  test("a cached value skips search", async () => {
    const value = { lat: 1, lon: 2, city: "Paris", country: "France" };
    const r = await resolveDestination("Paris, France", {
      search: async () => { throw new Error("should not search"); },
      cache: async () => value as never,
    });
    expect(r).toEqual(value);
  });
});
