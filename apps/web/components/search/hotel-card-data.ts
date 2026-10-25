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

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

export function formatRating(
  rating: number,
  reviews: number,
): { value: string; count: string; label: string } | null {
  if (!Number.isFinite(rating) || rating <= 0 || !(reviews > 0)) return null;
  const value = rating.toFixed(1);
  const count = reviews.toLocaleString("en-GB");
  return {
    value,
    count,
    label: `Rated ${value} out of 5 from ${count} ${reviews === 1 ? "review" : "reviews"}`,
  };
}

export function roomDetails(d: HotelCardData["description"]): string[] {
  return [d.type, d.bed, d.size].filter((part) => part.trim() !== "");
}

export function priceSummary(
  h: Pick<HotelCardData, "price" | "totalPrice" | "nights" | "currency">,
): { caption: string | null; amount: string; suffix: string; detail: string | null } {
  if (h.totalPrice !== null && h.nights !== null && h.nights > 0) {
    return {
      caption: null,
      amount: formatMoney(h.totalPrice, h.currency),
      suffix: "total",
      detail: `${h.nights} ${h.nights === 1 ? "night" : "nights"} · incl. taxes`,
    };
  }
  return {
    caption: "from",
    amount: formatMoney(h.price, h.currency),
    suffix: "/night",
    detail: null,
  };
}

export function photoAlt(name: string, index: number, total: number): string {
  return total > 1 ? `${name}, photo ${index + 1} of ${total}` : name;
}
