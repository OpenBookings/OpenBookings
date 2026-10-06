import { describe, expect, test } from "bun:test";
import {
  distanceKm,
  formatPostcode,
  nearPostcode,
  normalizePostcode,
  parseHouseNumber,
  parsePdokDocs,
  propertyCandidate,
  sharesName,
  trailingHouseNumber,
  type MaptilerFeature,
} from "./address-lookup";

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
  test("fills the address from the POI's own address tags", () => {
    const okura: MaptilerFeature = {
      id: "poi.1",
      text: "Hotel Okura Amsterdam",
      place_name: "Hotel Okura Amsterdam, Ferdinand Bolstraat 333, 1072 LH Amsterdam, Nederland",
      center: [4.893, 52.35],
      place_type: ["poi"],
      properties: {
        country_code: "nl",
        feature_tags: {
          "addr:street": "Ferdinand Bolstraat",
          "addr:housenumber": "333",
          "addr:postcode": "1072LH",
          "addr:city": "Amsterdam",
        },
      },
      context: [
        { id: "address.1", text: "Ferdinand Bolstraat" },
        { id: "place.1", text: "Zuid" },
        { id: "municipality.1", text: "Amsterdam" },
      ],
    };
    expect(propertyCandidate(okura)).toMatchObject({
      name: "Hotel Okura Amsterdam",
      addressLine1: "Ferdinand Bolstraat 333",
      postalCode: "1072 LH",
      city: "Amsterdam",
      country: "NL",
      missing: [],
    });
  });

  test("prefers the tagged street over the nearest one in the context", () => {
    const adlon: MaptilerFeature = {
      text: "Adlon Kempinski",
      center: [13.38, 52.516],
      place_type: ["poi"],
      properties: {
        country_code: "de",
        feature_tags: { "addr:street": "Unter den Linden", "addr:housenumber": "77", "addr:postcode": "10117", "addr:city": "Berlin" },
      },
      context: [{ id: "address.1", text: "Pariser Platz" }],
    };
    expect(propertyCandidate(adlon)?.addressLine1).toBe("Unter den Linden 77");
  });

  test("reports the street as missing for a named place without one", () => {
    const saturnia: MaptilerFeature = {
      text: "Terme Di Saturnia Spa & Golf",
      center: [11.517, 42.6595],
      place_type: ["poi"],
      properties: { country_code: "it", feature_tags: { "addr:postcode": "58014", "addr:city": "Saturnia" } },
      context: [
        { id: "postal_code.1", text: "58014" },
        { id: "municipality.1", text: "Manciano" },
      ],
    };
    expect(propertyCandidate(saturnia)).toMatchObject({
      addressLine1: "",
      postalCode: "58014",
      city: "Saturnia",
      country: "IT",
      missing: ["addressLine1"],
    });
  });

  test("uses a street result's own name and number", () => {
    const street: MaptilerFeature = {
      text: "Via delle Terme",
      center: [11.51, 42.655],
      place_type: ["address"],
      properties: { country_code: "it" },
      context: [
        { id: "postal_code.1", text: "58014" },
        { id: "place.1", text: "Saturnia" },
        { id: "municipality.1", text: "Manciano" },
      ],
    };
    expect(propertyCandidate(street)).toMatchObject({
      addressLine1: "Via delle Terme",
      postalCode: "58014",
      city: "Manciano",
      missing: [],
    });
  });

  test("drops a result without a country", () => {
    expect(propertyCandidate({ text: "Somewhere", center: [0, 0] })).toBeNull();
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

  test("nearPostcode keeps nearby results and drops far ones and landforms", () => {
    const kept = nearPostcode(
      [
        { text: "Terme di Saturnia", center: [11.517, 42.6595], place_type: ["poi"] },
        { text: "Località Monte", center: [14.5, 41.54], place_type: ["address"] },
        { text: "Fosso", center: [11.52, 42.62], place_type: ["major_landform"] },
        { text: "Via delle Terme", center: [11.51, 42.655], context: [{ id: "postal_code.1", text: "58014" }] },
      ],
      "58014",
      SATURNIA_POSTCODE,
    );
    expect(kept.map((f) => f.text)).toEqual(["Terme di Saturnia", "Via delle Terme"]);
  });
});
