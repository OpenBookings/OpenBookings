import { BACKDROPS } from "@openbookings/images";
import type { HotelCardData } from "@/components/search/HotelCard";
import type { DbRoom } from "@/app/p/[hotel_slug]/_components/constants";
import type { PropertyPagePayload, RawAmenity } from "./hotel-page-data";
import type { HotelPageData } from "./hotel-page-query";

/**
 * Fake properties for showing what the search and listing pages look like
 * without a database. Turn on with NEXT_PUBLIC_DEMO_DATA=true.
 *
 * Images reuse the backdrop set on cdn.openbookings.co, which the CSP already
 * allows.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_DATA === "true";
}

const image = (name: string) => BACKDROPS.find((b) => b.name === name)?.url ?? BACKDROPS[0].url;

// ── Factories ───────────────────────────────────────────────────────────────

let roomCounter = 0;

/** A room with a flexible and a non-refundable rate; `price` is the flexible nightly rate. */
export function makeDemoRoom({
  price = 240,
  currency = "EUR",
  ...overrides
}: Partial<DbRoom> & { price?: number; currency?: string } = {}): DbRoom {
  const id = `demo-room-${++roomCounter}`;
  return {
    id,
    name: "Deluxe Double Room",
    description: "A bright room with garden views, a rain shower and a king-size bed.",
    room_type: "Double",
    bed_type: "King bed",
    size_sqm: 32,
    max_occupancy: 2,
    images: [image("Tuscany")],
    rate_plans: [
      {
        id: `${id}-flex`,
        name: "Flexible",
        bar: price,
        currency,
        is_refundable: true,
        cancellation_policy: "Free cancellation up to 3 days before arrival.",
        meal_plan: "Breakfast included",
      },
      {
        id: `${id}-nr`,
        name: "Non-refundable",
        bar: Math.round(price * 0.88),
        currency,
        is_refundable: false,
        cancellation_policy: null,
        meal_plan: "Breakfast included",
      },
    ],
    tags: ["Wi-Fi", "Air conditioning", "Minibar"],
    ...overrides,
  };
}

export function makeDemoHotel(overrides: Partial<HotelPageData> = {}): HotelPageData {
  return {
    id: "demo-hotel",
    name: "Demo Hotel",
    subtitle: "A quiet place to stay",
    hero_image_url: image("Tuscany"),
    logo_image_url: null,
    gallery_images: [image("Tuscany"), image("Rome"), image("Lake Como")].map((url) => ({ url, alt_text: null })),
    lat: 43.7696,
    lon: 11.2558,
    address_line_1: "Via Roma 1",
    address_line_2: null,
    postal_code: "50123",
    city: "Florence",
    country: "IT",
    check_in_time: "15:00",
    check_in_until: "22:00",
    check_out_time: "11:00",
    overview_headline: "Stay in the heart of it all",
    overview_description:
      "A small, family-run hotel with fourteen rooms, a courtyard garden and breakfast made from local produce.",
    location_about: "A short walk from the old town, restaurants and the train station.",
    cta_headline: "Ready when you are",
    cta_body: "Book directly with the hotel for the best rate.",
    fine_print: ["City tax is paid at the property.", "Photo ID is required at check-in."],
    reception_24h: true,
    free_cancellation_days: 3,
    prepayment_required: true,
    children_welcome: true,
    min_check_in_age: 18,
    cot_policy: "free",
    cot_fee: null,
    extra_bed_fee: "€35 per night",
    pets_allowed: false,
    payment_methods: [
      { code: "visa", label: "Visa", artwork_url: null, note: null },
      { code: "mastercard", label: "Mastercard", artwork_url: null, note: null },
    ],
    legal_company_name: "Demo Hospitality S.r.l.",
    contact_email: "hello@example.com",
    contact_phone: "+39 055 000 0000",
    company_registration: "FI-000000",
    vat_number: "IT00000000000",
    highlights: [
      { label: "Old town", icon: "landmark", distance: "5 min walk" },
      { label: "Train station", icon: "train-front", distance: "1.2 km" },
    ],
    rates_confirmed: true,
    ...overrides,
  };
}

const DEFAULT_AMENITIES: RawAmenity[] = [
  { label: "Free Wi-Fi", icon: "wifi", category: "General", sort_order: 1 },
  { label: "Air conditioning", icon: "snowflake", category: "General", sort_order: 2 },
  { label: "Restaurant", icon: "utensils", category: "Food & drink", sort_order: 1 },
  { label: "Bar", icon: "wine", category: "Food & drink", sort_order: 2 },
  { label: "Spa", icon: "sparkles", category: "Wellness", sort_order: 1 },
  { label: "Outdoor pool", icon: "waves", category: "Wellness", sort_order: 2 },
];

// ── The demo set ────────────────────────────────────────────────────────────

type DemoProperty = { slug: string; rating: number; reviews: number; page: PropertyPagePayload };

function demoProperty(
  slug: string,
  hotel: Partial<HotelPageData>,
  rooms: DbRoom[],
  extra: { rating: number; reviews: number },
): DemoProperty {
  return {
    slug,
    ...extra,
    page: { hotel: makeDemoHotel({ id: `demo-${slug}`, ...hotel }), amenities: DEFAULT_AMENITIES, rooms },
  };
}

const DEMO_PROPERTIES: DemoProperty[] = [
  demoProperty(
    "terme-di-saturnia",
    {
      name: "Terme di Saturnia",
      subtitle: "A haven for regeneration and relaxation",
      hero_image_url: image("Tuscany"),
      lat: 42.6584,
      lon: 11.5041,
      address_line_1: "Via della Follonata",
      postal_code: "58014",
      city: "Saturnia",
      overview_headline: "Thermal springs in the Tuscan hills",
      overview_description:
        "A spa resort built around a 3,000-year-old thermal spring, with natural pools at 37°C, a medical spa and two restaurants.",
      location_about: "In the Maremma countryside, a two-hour drive from Rome or Florence.",
    },
    [
      makeDemoRoom({ name: "Classic Room", size_sqm: 28, price: 300 }),
      makeDemoRoom({ name: "Spa Suite", room_type: "Suite", size_sqm: 55, max_occupancy: 3, images: [image("Lake Como")], price: 500 }),
    ],
    { rating: 4.8, reviews: 1243 },
  ),
  demoProperty(
    "hotel-lago-como",
    { name: "Hotel Lago", subtitle: "Lakefront rooms with mountain views", hero_image_url: image("Lake Como"), city: "Como", lat: 45.8081, lon: 9.0852 },
    [makeDemoRoom({ name: "Lake View Double", images: [image("Lake Como")] })],
    { rating: 4.6, reviews: 512 },
  ),
  demoProperty(
    "casa-roma",
    { name: "Casa Roma", subtitle: "Boutique rooms near the Pantheon", hero_image_url: image("Rome"), city: "Rome", lat: 41.8986, lon: 12.4769 },
    [makeDemoRoom({ name: "Superior Double", images: [image("Rome")], price: 200 })],
    { rating: 4.4, reviews: 287 },
  ),
  demoProperty(
    "chalet-zermatt",
    { name: "Chalet Matterhorn", subtitle: "Ski-in, ski-out alpine lodge", hero_image_url: image("Zermatt"), city: "Zermatt", country: "CH", lat: 46.0207, lon: 7.7491 },
    [makeDemoRoom({ name: "Alpine Room", images: [image("Zermatt")], price: 360, currency: "CHF" })],
    { rating: 4.9, reviews: 98 },
  ),
];

// ── What the pages read ─────────────────────────────────────────────────────

/** Cards for the search page. Price is the cheapest nightly rate. */
export function getDemoSearchResults(): HotelCardData[] {
  return DEMO_PROPERTIES.map(({ slug, rating, reviews, page: { hotel, rooms } }) => {
    const cheapest = rooms.flatMap((r) => r.rate_plans).reduce((a, b) => (b.bar < a.bar ? b : a));
    const room = rooms[0];
    return {
      id: hotel.id,
      name: hotel.name,
      slug,
      distance: `${hotel.city}, ${hotel.country}`,
      rating,
      reviews,
      price: cheapest.bar,
      tags: [hotel.city, hotel.country, "Free Cancellation"],
      images: [...new Set([hotel.hero_image_url, ...hotel.gallery_images.map((g) => g.url)])].filter((u): u is string => !!u),
      description: { type: room.name, bed: room.bed_type ?? "", size: room.size_sqm ? `${room.size_sqm} m²` : "" },
    };
  });
}

/** The listing page for a demo slug, or null if the slug isn't one. */
export function getDemoHotelPage(slug: string): PropertyPagePayload | null {
  return DEMO_PROPERTIES.find((p) => p.slug === slug)?.page ?? null;
}
