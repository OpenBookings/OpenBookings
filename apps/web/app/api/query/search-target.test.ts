import { describe, expect, test } from "bun:test";
import { resolveSearchTarget } from "./search-target";

const found = async () => ({ lat: 48.85, lon: 2.35, city: "Paris", country: "France" });
const missing = async () => null;
const q = (s: string) => new URLSearchParams(s);

describe("resolveSearchTarget", () => {
  test("a destination without lat/lon is resolved", async () => {
    expect(await resolveSearchTarget(q("destination=Paris%2C+France"), found)).toEqual({
      ok: true, lat: "48.85", lon: "2.35", place: "Paris",
    });
  });
  test("explicit lat/lon win and the resolver is not called", async () => {
    const r = await resolveSearchTarget(q("destination=Paris&lat=1&lon=2"), async () => { throw new Error("called"); });
    expect(r).toEqual({ ok: true, lat: "1", lon: "2", place: "Paris" });
  });
  test("an unresolvable destination is a 400 message", async () => {
    expect(await resolveSearchTarget(q("destination=Nowhere"), missing)).toEqual({
      ok: false, errors: ["We couldn't find that destination. Try a city name."],
    });
  });
  test("the place param is accepted as the name", async () => {
    const r = await resolveSearchTarget(q("place=Paris"), found);
    expect(r.ok).toBe(true);
  });
  test("nothing at all leaves the existing coordinate errors", async () => {
    expect(await resolveSearchTarget(q(""), found)).toEqual({ ok: true, lat: null, lon: null, place: null });
  });
});
