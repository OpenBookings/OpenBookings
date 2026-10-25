import type { HotelCardData } from "@/components/search/hotel-card-data";

/** Shape returned by GET /api/query — see resolveSearchResults() in @openbookings/pricing */
export interface HotelSearchApiResult {
  hotel_id: string;
  hotel_name: string;
  hotel_slug: string;
  city: string;
  country: string;
  hero_image_url: string | null;
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

export function mapSearchResult(result: HotelSearchApiResult): HotelCardData {
  const nights = result.nights.length || null;
  return {
    id: result.hotel_id,
    name: result.hotel_name,
    slug: result.hotel_slug,
    location: `${result.city}, ${result.country}`,
    rating: 0,
    reviews: 0,
    price: Math.round(result.total_price / (nights ?? 1)),
    totalPrice: nights ? Math.round(result.total_price) : null,
    nights,
    currency: result.currency,
    freeCancellation: result.is_refundable,
    images: result.hero_image_url ? [result.hero_image_url] : [],
    description: { type: result.room_name, bed: "", size: "" },
  };
}
