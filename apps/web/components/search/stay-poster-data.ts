export type PriceMode = "total" | "night";

export type StayAvailability =
  /** `total` is the all-in price for the searched dates and guests, in major units. */
  | { status: "available"; nights: number; total: number; currency: string }
  /** Next free window as YYYY-MM-DD check-in and check-out dates, when known. */
  | { status: "unavailable"; nextFrom?: string; nextTo?: string }
  | { status: "undated" };

/** `focalX` / `focalY` run 0..1 from the top-left corner. */
export type StayCover = { url: string; tint: string | null; focalX: number; focalY: number };

export type StayPosterData = {
  id: string;
  name: string;
  slug: string;
  location: string; // "Como, IT"
  distanceKm: number | null; // from the searched point
  refundable: boolean;
  highlights: string[];
  cover: StayCover | null;
  availability: StayAvailability;
};

export type PosterPrice =
  | { kind: "price"; amount: string; unit: string; detail: string; long: boolean; cta: "View" }
  | { kind: "notice"; heading: string; detail: string | null; cta: "Dates" };

/** Card colour when a cover has no stored tint. Matches `--poster-tint-fallback`. */
export const POSTER_TINT_FALLBACK = "#0c0b0d";
export const DEFAULT_FOCAL = { x: 0.5, y: 0.4 } as const;

const MAX_HIGHLIGHTS = 2;
/** Up to 6 digits fit the 26px price at 300px wide; longer amounts drop to 22px. */
const LONG_AMOUNT_DIGITS = 6;

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

/** "0.8 km" below 10 km, "26 km" from 10 km up. */
export function formatDistance(km: number): string {
  const tenths = Math.max(0.1, Math.round(km * 10) / 10);
  return tenths >= 10 ? `${Math.round(km)} km` : `${tenths.toFixed(1)} km`;
}

export function posterEyebrow(s: Pick<StayPosterData, "location" | "distanceKm">): string {
  return s.distanceKm === null ? s.location : `${s.location} · ${formatDistance(s.distanceKm)} from centre`;
}

/** Cancellation label first (never dropped), then up to two highlights. */
export function posterTags(s: Pick<StayPosterData, "refundable" | "highlights">): string[] {
  const highlights = s.highlights.map((h) => h.trim()).filter(Boolean).slice(0, MAX_HIGHLIGHTS);
  return [s.refundable ? "Free cancellation" : "Non-refundable", ...highlights];
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "4–7 Dec" within a month, "30 Nov – 2 Dec" across months. */
export function formatDateRange(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${DAY.format(start)}–${DAY_MONTH.format(end)}`;
  }
  return `${DAY_MONTH.format(start)} – ${DAY_MONTH.format(end)}`;
}

function digitCount(text: string): number {
  return text.replace(/\D/g, "").length;
}

export function posterPrice(a: StayAvailability, mode: PriceMode): PosterPrice {
  if (a.status === "unavailable") {
    return {
      kind: "notice",
      heading: "Not available",
      detail: a.nextFrom && a.nextTo ? `Next free: ${formatDateRange(a.nextFrom, a.nextTo)}` : null,
      cta: "Dates",
    };
  }
  if (a.status === "undated") {
    return { kind: "notice", heading: "Add dates for prices", detail: null, cta: "Dates" };
  }

  const total = formatMoney(a.total, a.currency);
  // An average, because rate modifiers can make individual nights differ.
  const perNight = formatMoney(Math.round(a.total / a.nights), a.currency);
  const nights = `${a.nights} ${a.nights === 1 ? "night" : "nights"}`;
  const amount = mode === "total" ? total : perNight;
  return {
    kind: "price",
    amount,
    unit: mode === "total" ? "total" : "avg / night",
    detail: mode === "total" ? `${nights} · avg ${perNight} / night` : `${total} total · ${nights}`,
    long: digitCount(amount) > LONG_AMOUNT_DIGITS,
    cta: "View",
  };
}

/** Sort by total price; stays without a price always come last, in their original order. */
export function comparePrice(a: StayPosterData, b: StayPosterData, dir: "asc" | "desc"): number {
  const pa = a.availability.status === "available" ? a.availability.total : null;
  const pb = b.availability.status === "available" ? b.availability.total : null;
  if (pa === null || pb === null) return (pa === null ? 1 : 0) - (pb === null ? 1 : 0);
  return dir === "asc" ? pa - pb : pb - pa;
}

function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

/** CSS `object-position` for the cover's focal point. */
export function coverPosition(c: Pick<StayCover, "focalX" | "focalY">): string {
  return `${percent(c.focalX)} ${percent(c.focalY)}`;
}

/** Accessible name for the results list, e.g. "24 stays in Amsterdam". */
export function resultsListLabel(count: number, destination: string): string {
  const stays = `${count} ${count === 1 ? "stay" : "stays"}`;
  const place = destination.trim();
  return place ? `${stays} in ${place}` : stays;
}
