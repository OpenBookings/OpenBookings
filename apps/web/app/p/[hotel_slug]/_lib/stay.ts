import { parseStayInput } from "@/lib/booking/stay-input";
import { parseSearchDate } from "@/app/api/query/search-bounds";
import { clampGuests, type Guests } from "@/components/plug-in/guest-limits";

/**
 * The stay a guest is looking at on the property page, read from the URL
 * (`checkin`, `checkout`, `adults`, `children`, `infants`, `rooms`; search card
 * links set them). The page HTML is the same for everyone; this is read in the browser.
 */
export type Stay = {
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  infants: number;
  rooms: number;
};

const DAY_MS = 86_400_000;
const DEFAULT_PARTY: Guests = { adults: 2, children: 0, rooms: 1 };

/** Nights between two real YYYY-MM-DD dates. */
function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round(((parseSearchDate(checkOut) ?? 0) - (parseSearchDate(checkIn) ?? 0)) / DAY_MS);
}

/**
 * The stay in the URL, or null when it has no dates or they could not be
 * booked (reversed, too long, in the past where the hotel is). A missing
 * party is the search bar's default, 2 adults in 1 room.
 */
export function stayFromParams(p: URLSearchParams, todayInZone: string): Stay | null {
  if (!p.get("checkin") || !p.get("checkout")) return null;
  const withParty = new URLSearchParams(p);
  for (const key of ["adults", "rooms"] as const) {
    if (!withParty.get(key)) withParty.set(key, String(DEFAULT_PARTY[key]));
  }
  const parsed = parseStayInput(withParty, todayInZone);
  if (!parsed.ok) return null;
  const s = parsed.value;
  return { ...s, nights: nightsBetween(s.checkIn, s.checkOut) };
}

export function stayToParams(s: Omit<Stay, "nights">): URLSearchParams {
  const p = new URLSearchParams({ checkin: s.checkIn, checkout: s.checkOut, adults: String(s.adults) });
  if (s.children > 0) p.set("children", String(s.children));
  if (s.infants > 0) p.set("infants", String(s.infants));
  p.set("rooms", String(s.rooms));
  return p;
}

/** The party in the URL, with or without dates, as the guest picker allows it. */
export function partyFromParams(p: URLSearchParams): Guests {
  const read = (key: keyof Guests) => {
    const v = p.get(key);
    return v !== null && /^\d+$/.test(v) ? Number(v) : DEFAULT_PARTY[key];
  };
  return clampGuests({ adults: read("adults"), children: read("children"), rooms: read("rooms") });
}

const DAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Dec 16 – Dec 20". The dates are calendar dates, so they are read in UTC. */
export function stayDatesLabel(s: { checkIn: string; checkOut: string }): string {
  const day = (d: string) => DAY_LABEL.format(new Date(parseSearchDate(d) ?? 0));
  return `${day(s.checkIn)} – ${day(s.checkOut)}`;
}

/** "2 adults", "1 adult, 1 child". */
export function guestsLabel(g: { adults: number; children: number }): string {
  const adults = `${g.adults} ${g.adults === 1 ? "adult" : "adults"}`;
  if (g.children === 0) return adults;
  return `${adults}, ${g.children} ${g.children === 1 ? "child" : "children"}`;
}

/** What the date and guest pickers hand back: dates may still be missing. */
export type StayDraft = {
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  children: number;
  infants?: number;
  rooms: number;
};

/**
 * The URL's params with the picked stay written over them. Anything else in
 * the URL stays, except a pending `book`: that selection was for the old stay.
 */
export function withStay(current: URLSearchParams, next: StayDraft): URLSearchParams {
  const p = new URLSearchParams(current);
  for (const key of ["checkin", "checkout", "adults", "children", "infants", "rooms", "book"]) p.delete(key);
  const infants = next.infants ?? 0;
  const written =
    next.checkIn && next.checkOut
      ? stayToParams({ ...next, checkIn: next.checkIn, checkOut: next.checkOut, infants })
      : new URLSearchParams({
          adults: String(next.adults),
          ...(next.children > 0 ? { children: String(next.children) } : {}),
          ...(infants > 0 ? { infants: String(infants) } : {}),
          rooms: String(next.rooms),
        });
  for (const [k, v] of written) p.set(k, v);
  return p;
}
