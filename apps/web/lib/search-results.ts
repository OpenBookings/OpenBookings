import { DEFAULT_FOCAL, type StayPosterData } from "@/components/search/stay-poster-data";

/** Shape returned by GET /api/query — see resolveSearchResults() in @openbookings/pricing */
export interface HotelSearchApiResult {
  hotel_id: string;
  hotel_name: string;
  hotel_slug: string;
  city: string;
  country: string;
  hero_image_url: string | null;
  /** Metres from the searched point. */
  distance_m?: number;
  room_name: string;
  room_description: string;
  currency: string;
  is_refundable: boolean;
  total_price: number;
  nights: { date: string }[];
}

function utcDay(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whole nights between two YYYY-MM-DD dates, or null if unknown or not a forward stay. */
export function nightsBetween(checkIn: string, checkOut: string): number | null {
  const nights = (utcDay(checkOut) - utcDay(checkIn)) / 86_400_000;
  return Number.isInteger(nights) && nights > 0 ? nights : null;
}

const CDN_ORIGIN = "https://cdn.openbookings.co";

/** Absolute URL for a stored image path; relative paths live under the hotel's folder on the CDN. */
export function resolveCoverUrl(hotelId: string, url: string): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${CDN_ORIGIN}/${hotelId}/${url.replace(/^\/+/, "")}`;
}

export function mapSearchResult(result: HotelSearchApiResult): StayPosterData {
  const nights = result.nights.length;
  const coverUrl = result.hero_image_url ? resolveCoverUrl(result.hotel_id, result.hero_image_url) : null;
  return {
    id: result.hotel_id,
    name: result.hotel_name,
    slug: result.hotel_slug,
    location: `${result.city}, ${result.country}`,
    distanceKm: Number.isFinite(result.distance_m) ? (result.distance_m as number) / 1000 : null,
    refundable: result.is_refundable,
    // Host highlights aren't modelled yet.
    highlights: [],
    // Tint and focal point come from the cover pipeline, which doesn't exist yet.
    cover: coverUrl ? { url: coverUrl, tint: null, focalX: DEFAULT_FOCAL.x, focalY: DEFAULT_FOCAL.y } : null,
    availability:
      nights > 0
        ? { status: "available", nights, total: result.total_price, currency: result.currency }
        : { status: "undated" },
  };
}
