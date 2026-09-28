import { describe, expect, test } from "bun:test";
import { PROPERTY_PAGE_TTL, type PropertyPagePayload } from "./hotel-page-data";

/**
 * A payload shaped like a real row set, including the fields most likely to
 * break a JSON round trip if a future query changes: the `to_char` times, the
 * numeric coordinates, and the nested JSON aggregates.
 */
const fixture: PropertyPagePayload = {
  hotel: {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Terme di Saturnia",
    subtitle: "Thermal springs",
    hero_image_url: "https://cdn.example/hero.jpg",
    logo_image_url: null,
    gallery_images: [{ url: "https://cdn.example/1.jpg", alt_text: null }],
    lat: 42.6584,
    lon: 11.5041,
    address_line_1: "Via della Follonata",
    address_line_2: null,
    postal_code: "58014",
    city: "Saturnia",
    country: "IT",
    check_in_time: "15:00",
    check_in_until: null,
    check_out_time: "11:00",
    overview_headline: null,
    overview_description: null,
    location_about: null,
    cta_headline: null,
    cta_body: null,
    fine_print: null,
    reception_24h: null,
    free_cancellation_days: null,
    prepayment_required: null,
    children_welcome: null,
    min_check_in_age: null,
    cot_policy: null,
    cot_fee: null,
    extra_bed_fee: null,
    pets_allowed: null,
    payment_methods: [
      { code: "visa", label: "Visa", artwork_url: "https://cdn.example/visa.svg", note: null },
    ],
    legal_company_name: null,
    contact_email: null,
    contact_phone: null,
    company_registration: null,
    vat_number: null,
    highlights: [{ label: "Springs", icon: "droplet", distance: "50 m" }],
  },
  amenities: [{ label: "Wi-Fi", icon: "wifi", category: "General", sort_order: 1 }],
  rooms: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Deluxe",
      description: null,
      room_type: "double",
      bed_type: "king",
      size_sqm: 32,
      max_occupancy: 2,
      images: ["https://cdn.example/room.jpg"],
      rate_plans: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          name: "Flexible",
          bar: 240,
          currency: "EUR",
        },
      ],
      tags: ["Balcony"],
    } as PropertyPagePayload["rooms"][number],
  ],
};

describe("PropertyPagePayload", () => {
  /**
   * The cache stores JSON, so the payload must survive a round trip with no
   * custom reviver. It does today only because every timestamp leaves Postgres
   * as a `to_char` string. A future SELECT that adds a bare timestamptz would
   * start handing callers strings where they expect Date objects, and this is
   * the test that says so before production does.
   */
  test("survives a JSON round trip unchanged", () => {
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });

  test("contains no Date instances, which JSON would silently stringify", () => {
    const seen: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (value instanceof Date) seen.push(path);
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    walk(fixture, "payload");
    expect(seen).toEqual([]);
  });
});

describe("PROPERTY_PAGE_TTL", () => {
  test("keeps a stale window, so a database outage has something to serve", () => {
    expect(PROPERTY_PAGE_TTL.maxAgeSeconds).toBeGreaterThan(PROPERTY_PAGE_TTL.freshSeconds);
  });

  test("caches an absence far more briefly than a hit", () => {
    expect(PROPERTY_PAGE_TTL.missFreshSeconds).toBeLessThan(PROPERTY_PAGE_TTL.freshSeconds);
  });
});
