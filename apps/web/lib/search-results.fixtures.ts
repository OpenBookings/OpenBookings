import { DEFAULT_FOCAL, type StayPosterData } from "@/components/search/stay-poster-data";

/**
 * Four search cards for the search-result tests: priced at the cheapest rate
 * plan for the searched nights, one of them unavailable. Test-only; nothing in
 * the app serves these.
 */
type Fixture = {
  id: string;
  name: string;
  slug: string;
  city: string;
  country: string;
  heroUrl: string;
  /** Cheapest nightly rate and whether that plan is refundable. */
  cheapest: { bar: number; refundable: boolean };
  highlights: string[];
  tint: string;
  unavailable?: true;
};

const BASE = "https://cdn.openbookings.co/Public/backgrounds";

// Each cheapest plan is the non-refundable one: round(flexible bar x 0.88).
const FIXTURES: Fixture[] = [
  {
    id: "demo-terme-di-saturnia", name: "Terme di Saturnia", slug: "terme-di-saturnia", city: "Saturnia", country: "IT",
    heroUrl: "https://cdn.openbookings.co/Public/44ca5796-7461-488a-9613-be71394d4aaa/hero-image.jpg",
    cheapest: { bar: Math.round(300 * 0.88), refundable: false }, highlights: ["Thermal pools", "Medical spa"], tint: "#14100c",
  },
  {
    id: "demo-hotel-lago-como", name: "Hotel Lago", slug: "hotel-lago-como", city: "Como", country: "IT",
    heroUrl: `${BASE}/Italy-LakeComo.avif`,
    cheapest: { bar: Math.round(240 * 0.88), refundable: false }, highlights: ["Lakefront", "Mountain views"], tint: "#0a0f16",
  },
  {
    id: "demo-casa-roma", name: "Casa Roma", slug: "casa-roma", city: "Rome", country: "IT",
    heroUrl: `${BASE}/Italy-Rome.avif`,
    cheapest: { bar: Math.round(200 * 0.88), refundable: false }, highlights: ["Near the Pantheon"], tint: "#120e0c", unavailable: true,
  },
  {
    id: "demo-chalet-cervinia", name: "Chalet Matterhorn", slug: "chalet-cervinia", city: "Breuil-Cervinia", country: "IT",
    heroUrl: `${BASE}/Switzerland-Zermatt.avif`,
    cheapest: { bar: Math.round(360 * 0.88), refundable: false }, highlights: ["Ski-in, ski-out", "Mountain views"], tint: "#0b0e12",
  },
];

export function getDemoSearchResults(nights: number | null): StayPosterData[] {
  return FIXTURES.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    location: `${f.city}, ${f.country}`,
    distanceKm: null,
    refundable: f.cheapest.refundable,
    highlights: f.highlights,
    cover: { url: f.heroUrl, tint: f.tint, focalX: DEFAULT_FOCAL.x, focalY: DEFAULT_FOCAL.y },
    availability: f.unavailable
      ? { status: "unavailable" }
      : nights
        ? { status: "available", nights, total: f.cheapest.bar * nights }
        : { status: "undated" },
  }));
}
