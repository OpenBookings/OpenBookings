export type HotelCardData = {
  id: string;
  name: string;
  slug: string;
  location: string; // "Como, IT"
  rating: number; // 0–5
  reviews: number;
  price: number; // per night, tax-inclusive
  totalPrice: number | null; // whole stay, tax-inclusive; null when nights unknown
  nights: number | null;
  currency: string; // ISO 4217
  freeCancellation: boolean;
  description: { type: string; bed: string; size: string };
  images: string[];
};
