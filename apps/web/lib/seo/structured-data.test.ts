import { describe, expect, test } from "bun:test";
import {
  homepageJsonLd,
  hotelJsonLd,
  priceRange,
  propertyBreadcrumbJsonLd,
  serializeJsonLd,
  type HotelJsonLdInput,
} from "./structured-data";
import { metaDescription } from "./site";

const HOTEL: HotelJsonLdInput["hotel"] = {
  name: "Terme Di Saturnia",
  subtitle: "Thermal spa in Tuscany",
  overview_description: "Where stillness meets the sea.",
  hero_image_url: "https://cdn.openbookings.co/Public/x/hero.jpg",
  gallery_images: [{ url: "https://cdn.openbookings.co/Public/x/1.jpg", alt_text: null }],
  lat: 42.65,
  lon: 11.5,
  address_line_1: "Strada Saturnia-Pitigliano",
  address_line_2: null,
  postal_code: "58014",
  city: "Saturnia",
  country: "IT",
  check_in_time: "14:00",
  check_out_time: "10:00",
  pets_allowed: true,
};

const input = (over: Partial<HotelJsonLdInput> = {}): HotelJsonLdInput => ({
  slug: "terme-di-saturnia",
  hotel: HOTEL,
  amenities: ["Spa", "Pool"],
  rooms: [{ rate_plans: [{ price_per_night_cents: 12000, bar_cents: 15000 }, { bar_cents: 34000 }] }],
  reviews: { reviews: [], total: 8, recentCount: 8, average: 7.6 },
  ...over,
});

describe("hotelJsonLd", () => {
  test("describes the property from the page's own data", () => {
    const ld = hotelJsonLd(input());
    expect(ld).toMatchObject({
      "@type": "Hotel",
      name: "Terme Di Saturnia",
      url: "https://openbookings.co/p/terme-di-saturnia",
      description: "Where stillness meets the sea.",
      image: ["https://cdn.openbookings.co/Public/x/hero.jpg", "https://cdn.openbookings.co/Public/x/1.jpg"],
      address: {
        "@type": "PostalAddress",
        streetAddress: "Strada Saturnia-Pitigliano",
        addressLocality: "Saturnia",
        postalCode: "58014",
        addressCountry: "IT",
      },
      geo: { "@type": "GeoCoordinates", latitude: 42.65, longitude: 11.5 },
      checkinTime: "14:00",
      checkoutTime: "10:00",
      petsAllowed: true,
      priceRange: "€120 – €340",
      aggregateRating: { ratingValue: 7.6, reviewCount: 8, bestRating: 10, worstRating: 1 },
    });
    expect(ld.amenityFeature).toEqual([
      { "@type": "LocationFeatureSpecification", name: "Spa", value: true },
      { "@type": "LocationFeatureSpecification", name: "Pool", value: true },
    ]);
  });

  test("leaves the rating out when the page shows no score", () => {
    expect(hotelJsonLd(input({ reviews: { reviews: [], total: 2, recentCount: 2, average: null } }))).not.toHaveProperty("aggregateRating");
    expect(hotelJsonLd(input({ reviews: null }))).not.toHaveProperty("aggregateRating");
  });

  test("leaves out what the host has not filled in", () => {
    const ld = hotelJsonLd(
      input({
        hotel: { ...HOTEL, overview_description: null, subtitle: null, hero_image_url: null, gallery_images: [], postal_code: null, pets_allowed: null },
        amenities: [],
        rooms: [],
      }),
    );
    for (const key of ["description", "image", "petsAllowed", "amenityFeature", "priceRange"]) {
      expect(ld).not.toHaveProperty(key);
    }
    expect(ld.address).not.toHaveProperty("postalCode");
  });

  test("never carries the host's contact details", () => {
    const json = serializeJsonLd(hotelJsonLd(input()));
    expect(json).not.toContain("email");
    expect(json).not.toContain("telephone");
  });
});

describe("priceRange", () => {
  test("one price shows once", () => {
    expect(priceRange([{ rate_plans: [{ bar_cents: 9950 }] }])).toBe("€99.50");
  });
  test("no rates, no range", () => {
    expect(priceRange([{ rate_plans: [] }])).toBeUndefined();
  });
});

test("breadcrumb runs from the site to the property", () => {
  expect(propertyBreadcrumbJsonLd("terme-di-saturnia", "Terme Di Saturnia").itemListElement).toEqual([
    { "@type": "ListItem", position: 1, name: "OpenBookings", item: "https://openbookings.co/" },
    { "@type": "ListItem", position: 2, name: "Terme Di Saturnia", item: "https://openbookings.co/p/terme-di-saturnia" },
  ]);
});

test("homepage names the organisation and the site", () => {
  expect(homepageJsonLd().map((d) => d["@type"])).toEqual(["Organization", "WebSite"]);
});

describe("serializeJsonLd", () => {
  test("host text cannot close the script tag", () => {
    const json = serializeJsonLd({ description: "Nice</script><script>alert(1)</script>" });
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json)).toEqual({ description: "Nice</script><script>alert(1)</script>" });
  });
});

describe("metaDescription", () => {
  test("short text is kept whole, whitespace collapsed", () => {
    expect(metaDescription("  Quiet\n rooms ")).toBe("Quiet rooms");
  });
  test("long text is cut at a word boundary", () => {
    const out = metaDescription("word ".repeat(60));
    expect(out.length).toBeLessThanOrEqual(155);
    expect(out.endsWith("word…")).toBe(true);
  });
});
