import { describe, expect, test } from "bun:test";
import {
  distanceKm,
  formatPostcode,
  isExactNumber,
  nearPostcode,
  normalizePostcode,
  parseHouseNumber,
  parsePdokDocs,
  propertyCandidate,
  searchProperty,
  sharesName,
  trailingHouseNumber,
} from "./address-lookup";
import type { TomtomResult } from "@openbookings/maps";

describe("postcodes", () => {
  test("normalise without spaces or case", () => {
    expect(normalizePostcode(" 3011 ad ")).toBe("3011AD");
  });

  test("format Dutch postcodes with their space, leave others alone", () => {
    expect(formatPostcode("3011ad", "nl")).toBe("3011 AD");
    expect(formatPostcode("10117", "DE")).toBe("10117");
  });
});

describe("house numbers", () => {
  test.each([
    ["10", "10", ""],
    ["10a", "10", "a"],
    ["10 A", "10", "a"],
    ["10-2", "10", "2"],
    ["10 bis", "10", "bis"],
  ])("parseHouseNumber(%s)", (input, number, addition) => {
    expect(parseHouseNumber(input)).toEqual({ number, addition });
  });

  test("parseHouseNumber rejects input without a leading number", () => {
    expect(parseHouseNumber("a10")).toBeNull();
    expect(parseHouseNumber("")).toBeNull();
  });

  test("trailingHouseNumber finds the number at the end of a street line, if any", () => {
    expect(trailingHouseNumber("Coolsingel 10a")).toBe("10a");
    expect(trailingHouseNumber("Unter den Linden 77")).toBe("77");
    expect(trailingHouseNumber("Località Follonata")).toBeUndefined();
  });
});

describe("parsePdokDocs", () => {
  const docs = [
    { id: "a", straatnaam: "Coolsingel", huisnummer: 10, postcode: "3011AD", woonplaatsnaam: "Rotterdam", centroide_ll: "POINT(4.47889295 51.92347616)" },
    { id: "b", straatnaam: "Coolsingel", huisnummer: 10, huisletter: "A", postcode: "3011AD", woonplaatsnaam: "Rotterdam", centroide_ll: "POINT(4.4789 51.9235)" },
    { id: "c", straatnaam: "Coolsingel", huisnummer: 10, huisletter: "B", huisnummertoevoeging: "1", postcode: "3011AD", woonplaatsnaam: "Rotterdam", centroide_ll: "POINT(4.4789 51.9235)" },
  ];

  test("builds an address, longitude first from the WKT point", () => {
    expect(parsePdokDocs(docs, "")[0]).toMatchObject({
      addressLine1: "Coolsingel 10",
      postalCode: "3011 AD",
      city: "Rotterdam",
      country: "NL",
      lon: 4.47889295,
      lat: 51.92347616,
    });
  });

  test("keeps every addition when none was asked for, narrows when one was", () => {
    expect(parsePdokDocs(docs, "").map((c) => c.addressLine1)).toEqual([
      "Coolsingel 10",
      "Coolsingel 10A",
      "Coolsingel 10B-1",
    ]);
    expect(parsePdokDocs(docs, "b").map((c) => c.addressLine1)).toEqual(["Coolsingel 10B-1"]);
  });
});

describe("propertyCandidate", () => {
  const okura: TomtomResult = {
    type: "POI",
    id: "x1",
    poi: {
      name: "The Leading Hotels of the World Hotel Okura Amsterdam",
      brands: [{ name: "The Leading Hotels of the World" }],
    },
    address: {
      streetName: "Ferdinand Bolstraat",
      streetNumber: "333",
      postalCode: "1072",
      extendedPostalCode: "1072 LH",
      municipality: "Amsterdam",
      localName: "Amsterdam",
      countryCode: "NL",
      freeformAddress: "Ferdinand Bolstraat 333, 1072 LH Amsterdam",
    },
    position: { lat: 52.3486, lon: 4.893 },
  };

  test("fills the address from a hotel result, brand prefix dropped, full Dutch postcode", () => {
    expect(propertyCandidate(okura)).toMatchObject({
      name: "Hotel Okura Amsterdam",
      label: "Hotel Okura Amsterdam, Ferdinand Bolstraat 333, 1072 LH Amsterdam",
      addressLine1: "Ferdinand Bolstraat 333",
      postalCode: "1072 LH",
      city: "Amsterdam",
      country: "NL",
      lon: 4.893,
      lat: 52.3486,
      missing: [],
    });
  });

  test("keeps a name that is only the brand", () => {
    expect(propertyCandidate({ ...okura, poi: { name: "Hilton", brands: [{ name: "Hilton" }] } })?.name).toBe("Hilton");
  });

  test("takes the first postcode from a list", () => {
    expect(
      propertyCandidate({ ...okura, address: { ...okura.address, extendedPostalCode: "1072 LH, 1072 LJ" } })?.postalCode,
    ).toBe("1072 LH");
  });

  test("reports the street as missing when a place has none", () => {
    const saturnia: TomtomResult = {
      type: "POI",
      poi: { name: "Terme di Saturnia" },
      address: { postalCode: "58014", municipality: "Manciano", localName: "Manciano", countryCode: "IT", freeformAddress: "58014 Manciano" },
      position: { lat: 42.6578, lon: 11.5165 },
    };
    expect(propertyCandidate(saturnia)).toMatchObject({
      addressLine1: "",
      postalCode: "58014",
      city: "Manciano",
      country: "IT",
      missing: ["addressLine1"],
    });
  });

  test("an address-only result is named by its street and keeps the ISO country", () => {
    const pa: TomtomResult = {
      type: "Point Address",
      address: {
        streetName: "Unter den Linden",
        streetNumber: "77",
        postalCode: "10117",
        municipality: "Berlin",
        localName: "Berlin",
        countryCode: "DE",
        freeformAddress: "Unter den Linden 77, 10117 Berlin",
      },
      position: { lat: 52.516133, lon: 13.380149 },
    };
    expect(propertyCandidate(pa)).toMatchObject({
      name: "Unter den Linden",
      label: "Unter den Linden 77, 10117 Berlin",
      addressLine1: "Unter den Linden 77",
      country: "DE",
      missing: [],
    });
  });

  test("drops a result without a country or position", () => {
    expect(propertyCandidate({ type: "POI", address: {}, position: { lat: 0, lon: 0 } })).toBeNull();
    expect(propertyCandidate({ ...okura, position: undefined })).toBeNull();
  });
});

describe("searchProperty", () => {
  test("refuses to run without a key", async () => {
    await expect(searchProperty("Okura", "", new AbortController().signal)).rejects.toThrow("No TomTom key configured");
  });
});

describe("placing a typed address", () => {
  const SATURNIA_POSTCODE: [number, number] = [11.51, 42.6115];

  test("sharesName ignores street-type words and the bare town", () => {
    expect(sharesName("Via delle Terme 1", "Via delle Terme")).toBe(true);
    expect(sharesName("Località Follonata", "Saturnia")).toBe(false);
    expect(sharesName("Località Follonata", "Strada Provinciale 10 della Follonata")).toBe(true);
    expect(sharesName("Hauptstraße 5", "Hauptstrasse")).toBe(true);
    expect(sharesName("Via Roma 1", "Via Milano")).toBe(false);
  });

  test("distanceKm is roughly right", () => {
    // The spa sits about 5 km north of 58014's centre point.
    expect(distanceKm(SATURNIA_POSTCODE, [11.517, 42.6595])).toBeGreaterThan(4.5);
    expect(distanceKm(SATURNIA_POSTCODE, [11.517, 42.6595])).toBeLessThan(6);
  });

  test("isExactNumber compares the leading number only", () => {
    expect(isExactNumber("1870/16", "1870")).toBe(true);
    expect(isExactNumber("2/B", "2b")).toBe(true);
    expect(isExactNumber("77", "7")).toBe(false);
    expect(isExactNumber(undefined, "7")).toBe(false);
  });

  test("nearPostcode keeps nearby results and drops far ones and whole regions", () => {
    const at = (lon: number, lat: number) => ({ lat, lon });
    const kept = nearPostcode(
      [
        { type: "POI", poi: { name: "Terme di Saturnia" }, address: { postalCode: "58014" }, position: at(11.5165, 42.6578) },
        { type: "Street", address: { streetName: "Via Saturnia" }, position: at(13.7049, 41.2863) },
        { type: "Geography", entityType: "CountrySubdivision", address: {}, position: at(11.5, 42.62) },
        { type: "Street", address: { streetName: "Via Italia in Saturnia" }, position: at(11.5077, 42.6667) },
      ],
      "58014",
      [11.493, 42.5721],
    );
    expect(kept.map((r) => r.poi?.name ?? r.address.streetName)).toEqual(["Terme di Saturnia", "Via Italia in Saturnia"]);
  });
});
