import { formatCents } from "@openbookings/pricing/money";
import type { PropertyReviews } from "@openbookings/db/reviews";
import type { HotelPageData } from "@/lib/hotel-page-query";
import { SITE_NAME, SITE_URL, absoluteUrl, propertyPath } from "./site";

/**
 * schema.org JSON-LD for the guest site. Every builder takes the data the page
 * itself renders, never a query of its own, so search engines read exactly
 * what guests see. Leave a field out rather than guess it: a missing field
 * costs a rich result, a wrong one can cost a manual action.
 *
 * Contact details are deliberately absent. The page hides the host's email
 * and phone behind a hover to keep them from scrapers, and JSON-LD would hand
 * them straight back.
 */

type JsonLd = Record<string, unknown>;

const GITHUB_URL = "https://github.com/OpenBookings/OpenBookings";

/** The slice of a room the price range needs, after `withAllInPrices`. */
export type PricedRoom = {
  rate_plans: { price_per_night_cents?: number; bar_cents: number }[];
};

export type HotelJsonLdInput = {
  slug: string;
  hotel: Pick<
    HotelPageData,
    | "name"
    | "subtitle"
    | "overview_description"
    | "hero_image_url"
    | "gallery_images"
    | "lat"
    | "lon"
    | "address_line_1"
    | "address_line_2"
    | "postal_code"
    | "city"
    | "country"
    | "check_in_time"
    | "check_out_time"
    | "pets_allowed"
  >;
  /** Amenity labels, as the page lists them. */
  amenities: string[];
  rooms: PricedRoom[];
  reviews: PropertyReviews | null;
};

/**
 * "€120 – €340" across the nightly prices the room cards show (all-in,
 * tonight where it can be booked, the base rate otherwise). Undefined when no
 * room has a rate.
 */
export function priceRange(rooms: PricedRoom[]): string | undefined {
  const cents = rooms
    .flatMap((room) => room.rate_plans.map((plan) => plan.price_per_night_cents ?? plan.bar_cents))
    .filter((c) => Number.isFinite(c) && c > 0);
  if (cents.length === 0) return undefined;
  const low = Math.min(...cents);
  const high = Math.max(...cents);
  return low === high ? formatCents(low) : `${formatCents(low)} – ${formatCents(high)}`;
}

export function hotelJsonLd({ slug, hotel, amenities, rooms, reviews }: HotelJsonLdInput): JsonLd {
  const url = absoluteUrl(propertyPath(slug));
  const images = [hotel.hero_image_url, ...(hotel.gallery_images ?? []).map((g) => g.url)]
    .filter((u): u is string => Boolean(u))
    .slice(0, 10);
  const street = [hotel.address_line_1, hotel.address_line_2].filter(Boolean).join(", ");
  const description = hotel.overview_description?.trim() || hotel.subtitle?.trim();
  const range = priceRange(rooms);

  return {
    "@context": "https://schema.org",
    "@type": "Hotel",
    "@id": `${url}#hotel`,
    name: hotel.name,
    url,
    ...(description ? { description } : {}),
    ...(images.length ? { image: images } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: street,
      addressLocality: hotel.city,
      ...(hotel.postal_code ? { postalCode: hotel.postal_code } : {}),
      addressCountry: hotel.country,
    },
    ...(Number.isFinite(hotel.lat) && Number.isFinite(hotel.lon)
      ? { geo: { "@type": "GeoCoordinates", latitude: hotel.lat, longitude: hotel.lon } }
      : {}),
    ...(hotel.check_in_time ? { checkinTime: hotel.check_in_time } : {}),
    ...(hotel.check_out_time ? { checkoutTime: hotel.check_out_time } : {}),
    ...(hotel.pets_allowed === null ? {} : { petsAllowed: hotel.pets_allowed }),
    ...(amenities.length
      ? {
          amenityFeature: amenities.map((name) => ({
            "@type": "LocationFeatureSpecification",
            name,
            value: true,
          })),
        }
      : {}),
    ...(range ? { priceRange: range, currenciesAccepted: "EUR" } : {}),
    // Only when the page shows a score itself (3+ reviews in 24 months).
    ...(reviews?.average != null && reviews.recentCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: reviews.average,
            reviewCount: reviews.recentCount,
            bestRating: 10,
            worstRating: 1,
          },
        }
      : {}),
  };
}

export function propertyBreadcrumbJsonLd(slug: string, name: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name, item: absoluteUrl(propertyPath(slug)) },
    ],
  };
}

/** For the homepage: who runs the site, and the site itself. */
export function homepageJsonLd(): JsonLd[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      logo: absoluteUrl("/Openbookings-logo-v2.svg"),
      sameAs: [GITHUB_URL],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ];
}

/**
 * JSON for a `<script type="application/ld+json">`. Hosts write most of this
 * text, so `<` is escaped: a description containing `</script>` must not end
 * the tag early and turn the rest into markup.
 */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
