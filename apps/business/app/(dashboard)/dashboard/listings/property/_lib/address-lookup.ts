import { COUNTRIES } from "./countries";

/**
 * Finding a property's address, and placing an address on the map.
 *
 * Two jobs, two entry points:
 *
 * - `searchProperty`: the host types their property's name ("Terme di
 *   Saturnia", "Hotel Okura Amsterdam") and picks it. MapTiler's points of
 *   interest carry OpenStreetMap's address tags (`addr:street`,
 *   `addr:postcode`, …), so one pick fills the address *and* places the pin on
 *   the building rather than on the street. A named place without a street —
 *   a rural estate — comes back with that line missing, and the editor opens
 *   the address lines for the host to complete.
 *
 * - `locateTypedAddress`: the host edited the address lines by hand. The pin
 *   follows the address, so the typed address is placed — exactly where it can
 *   be, approximately where only the street is known, and not at all when no
 *   result is about what was typed. A Dutch postcode + number goes to PDOK (the
 *   government's BAG register, exact for every Dutch address) through our own
 *   /api/address-lookup/nl, so the host's browser never talks to a vendor the
 *   privacy policy does not list. Everything else goes to MapTiler, already
 *   our map vendor.
 */

export interface AddressFields {
  addressLine1: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
}

export interface AddressCandidate extends AddressFields {
  /** Stable within one result list, for React keys and selection. */
  id: string;
  /** What the host searched for: the property or place name. */
  name: string;
  /** The full line shown in the result list. */
  label: string;
  lon: number;
  lat: number;
  /** Address lines the result could not fill in; the host completes them. */
  missing: (keyof AddressFields)[];
}

/** Postcodes compared without spaces or case: "1012 lg" and "1012LG" are one postcode. */
export function normalizePostcode(postcode: string): string {
  return postcode.replace(/\s+/g, "").toUpperCase();
}

/** Display form: Dutch postcodes get their conventional space ("3011 AD"). */
export function formatPostcode(postcode: string, country: string): string {
  const n = normalizePostcode(postcode);
  if (country.toUpperCase() === "NL" && /^\d{4}[A-Z]{2}$/.test(n)) return `${n.slice(0, 4)} ${n.slice(4)}`;
  return postcode.trim();
}

/** "10", "10a", "10-2", "10 bis" → number 10 plus whatever follows it. */
export function parseHouseNumber(input: string): { number: string; addition: string } | null {
  const m = /^\s*(\d+)\s*[-\s]?\s*([a-z0-9]*)\s*$/i.exec(input);
  if (!m) return null;
  return { number: m[1], addition: m[2].toLowerCase() };
}

/** "Coolsingel 10a" → "10a"; "Località Follonata" → undefined. */
export function trailingHouseNumber(line: string): string | undefined {
  return /\s(\d+\s*[a-z]?(?:-\w+)?)\s*$/i.exec(line)?.[1];
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`lookup ${res.status}`);
  return (await res.json()) as T;
}

// ── PDOK (Netherlands) ─────────────────────────────────────────────────────

export interface PdokDoc {
  id?: string;
  straatnaam?: string;
  huisnummer?: number;
  huisletter?: string;
  huisnummertoevoeging?: string;
  postcode?: string;
  woonplaatsnaam?: string;
  /** WKT: "POINT(4.47889295 51.92347616)" — longitude first. */
  centroide_ll?: string;
}

export interface DutchAddress extends AddressFields {
  label: string;
  lon: number;
  lat: number;
}

export function pdokSearchUrl(postcode: string, number: string): string {
  const params = new URLSearchParams({
    q: `postcode:${normalizePostcode(postcode)} and huisnummer:${number}`,
    fq: "type:adres",
    fl: "id,straatnaam,huisnummer,huisletter,huisnummertoevoeging,postcode,woonplaatsnaam,centroide_ll",
    rows: "20",
  });
  return `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?${params}`;
}

export function parsePdokDocs(docs: PdokDoc[], addition: string): DutchAddress[] {
  const out: DutchAddress[] = [];
  for (const d of docs) {
    const point = /POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/.exec(d.centroide_ll ?? "");
    if (!point || !d.straatnaam || d.huisnummer === undefined || !d.postcode || !d.woonplaatsnaam) continue;

    const suffix = `${d.huisletter ?? ""}${d.huisnummertoevoeging ? `-${d.huisnummertoevoeging}` : ""}`;
    // "10a" asked for: keep 10a, 10A-1; drop 10 and 10b. No addition: keep all.
    if (addition && !suffix.replace("-", "").toLowerCase().startsWith(addition)) continue;

    const addressLine1 = `${d.straatnaam} ${d.huisnummer}${suffix}`;
    const postalCode = formatPostcode(d.postcode, "NL");
    out.push({
      label: `${addressLine1}, ${postalCode} ${d.woonplaatsnaam}`,
      addressLine1,
      postalCode,
      city: d.woonplaatsnaam,
      country: "NL",
      lon: Number(point[1]),
      lat: Number(point[2]),
    });
  }
  return out;
}

async function lookupDutchAddress(postcode: string, houseNumber: string, signal: AbortSignal) {
  const params = new URLSearchParams({ postcode, number: houseNumber });
  const body = await getJson<{ candidates: DutchAddress[] }>(`/api/address-lookup/nl?${params}`, signal);
  return body.candidates;
}

// ── MapTiler ───────────────────────────────────────────────────────────────

export interface MaptilerFeature {
  id?: string;
  /** Full display name, e.g. "Hotel Okura Amsterdam, Ferdinand Bolstraat 333, …". */
  place_name?: string;
  /** The feature's own name: a street for an address, a business for a POI. */
  text?: string;
  /** House number, when the feature is a numbered address. */
  address?: string;
  center?: [number, number];
  place_type?: string[];
  properties?: {
    country_code?: string;
    /** OpenStreetMap tags, including `addr:*` on most POIs. */
    feature_tags?: Record<string, string>;
  };
  context?: { id: string; text: string }[];
}

export function maptilerUrl(query: string, key: string, params: Record<string, string>): string {
  const search = new URLSearchParams({ key, ...params });
  return `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?${search}`;
}

function contextText(f: MaptilerFeature, ...prefixes: string[]): string | undefined {
  for (const p of prefixes) {
    const hit = f.context?.find((c) => c.id.startsWith(p))?.text;
    if (hit) return hit;
  }
  return undefined;
}

/** Every country a property can be in, as MapTiler's comma-separated filter. */
const SEARCH_COUNTRIES = COUNTRIES.map((c) => c.code.toLowerCase()).join(",");

/**
 * A search result as an address. OpenStreetMap's own `addr:*` tags win: the
 * geocoder's context names the *nearest* street, and for the Adlon that is
 * Pariser Platz while its address is Unter den Linden 77. For a city, the
 * municipality beats the context's `place`, which is often a district ("Zuid").
 */
export function propertyCandidate(f: MaptilerFeature): AddressCandidate | null {
  if (!f.text || !f.center) return null;
  const tags = f.properties?.feature_tags ?? {};
  const country = (f.properties?.country_code ?? tags["addr:country"] ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return null;

  const isAddress = f.place_type?.includes("address");
  const street = tags["addr:street"] ?? (isAddress ? f.text : undefined);
  const number = tags["addr:housenumber"] ?? (isAddress ? f.address : undefined);
  const addressLine1 = [street, street ? number : undefined].filter(Boolean).join(" ");

  const rawPostcode = tags["addr:postcode"] ?? contextText(f, "postal_code") ?? "";
  const postalCode = rawPostcode ? formatPostcode(rawPostcode, country) : "";
  const city =
    tags["addr:city"] ??
    contextText(f, "municipality", "municipal_district", "locality", "place") ??
    (f.place_type?.includes("place") ? f.text : "");

  const missing = (
    [
      ["addressLine1", addressLine1],
      ["postalCode", postalCode],
      ["city", city],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return {
    id: f.id ?? `${f.text}-${f.center.join(",")}`,
    name: f.text,
    label: f.place_name ?? f.text,
    addressLine1,
    postalCode,
    city,
    country,
    lon: f.center[0],
    lat: f.center[1],
    missing,
  };
}

/** Property or place name → candidates anywhere a property can be. */
export async function searchProperty(query: string, key: string, signal: AbortSignal): Promise<AddressCandidate[]> {
  if (!key) throw new Error("No MapTiler key configured");
  const body = await getJson<{ features?: MaptilerFeature[] }>(
    maptilerUrl(query.trim(), key, { country: SEARCH_COUNTRIES, types: "poi,address,place", limit: "8" }),
    signal,
  );
  const seen = new Set<string>();
  return (body.features ?? [])
    .map(propertyCandidate)
    .filter((c): c is AddressCandidate => {
      if (!c || seen.has(c.label.toLowerCase())) return false;
      seen.add(c.label.toLowerCase());
      return true;
    });
}

// ── Typed address → pin ────────────────────────────────────────────────────

/**
 * How far a result may sit from the postcode's centre and still count as "in
 * this postcode". Rural postcodes are large: 58014 spans Manciano and
 * Saturnia, whose spa lies 5 km from the postcode's centre point.
 */
export const NEAR_POSTCODE_KM = 15;

/** Feature kinds that can be a property's location. Rivers and hills cannot. */
const LOCATABLE_TYPES = "address,poi,place,locality,neighbourhood,road";

export function distanceKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Keep results that belong to this postcode: inside it by their own context,
 * or near its centre when they carry no postcode at all. Without a postcode
 * centre, the country filter on the request is all there is.
 */
export function nearPostcode(
  features: MaptilerFeature[],
  postcode: string,
  centre: [number, number] | null,
): MaptilerFeature[] {
  const want = normalizePostcode(postcode);
  return features.filter((f) => {
    if (!f.center || f.place_type?.includes("major_landform")) return false;
    const pc = contextText(f, "postal_code");
    if (want && pc) return normalizePostcode(pc) === want || (!!centre && distanceKm(centre, f.center) <= NEAR_POSTCODE_KM);
    return !centre || distanceKm(centre, f.center) <= NEAR_POSTCODE_KM;
  });
}

async function postcodeCentre(
  postcode: string,
  country: string,
  key: string,
  signal: AbortSignal,
): Promise<[number, number] | null> {
  if (!postcode.trim()) return null;
  const body = await getJson<{ features?: MaptilerFeature[] }>(
    maptilerUrl(postcode.trim(), key, { country: country.toLowerCase(), types: "postal_code", limit: "1" }),
    signal,
  );
  return body.features?.[0]?.center ?? null;
}

/**
 * Street-type words and articles, in the languages of the countries we list.
 * They match everything ("Via", "Straße"), so they cannot show that a result is
 * the place the host meant.
 */
const GENERIC_WORDS = new Set([
  "via", "viale", "vicolo", "strada", "piazza", "localita", "frazione", "delle", "della", "dello", "degli",
  "rue", "avenue", "chemin", "route", "place", "boulevard", "allee",
  "strasse", "weg", "platz", "gasse", "straat", "laan", "plein", "steeg", "kade", "gracht",
  "calle", "avenida", "carrer", "camino", "plaza", "rua", "travessa", "estrada",
  "street", "road", "lane", "drive", "square",
]);

function nameWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
}

/** Whether a result's name shares a distinctive word with what the host typed. */
export function sharesName(typed: string, found: string): boolean {
  const want = new Set(nameWords(typed));
  return nameWords(found).some((w) => want.has(w));
}

export interface LocatedAddress {
  lon: number;
  lat: number;
  label: string;
  /**
   * "exact": the house itself was found. "approximate": only the street,
   * place or area was — good enough to start from, not to trust.
   */
  precision: "exact" | "approximate";
}

/**
 * Place a typed address, or return null when it cannot be placed with
 * confidence — the caller then asks the host to set the pin by hand rather
 * than guessing.
 */
export async function locateTypedAddress(
  input: AddressFields,
  key: string,
  signal: AbortSignal,
): Promise<LocatedAddress | null> {
  const hn = trailingHouseNumber(input.addressLine1);

  // A Dutch postcode plus a number is an exact BAG lookup; no need to guess.
  const parsed = hn ? parseHouseNumber(hn) : null;
  if (input.country.toUpperCase() === "NL" && parsed && /^\d{4}[A-Z]{2}$/.test(normalizePostcode(input.postalCode))) {
    const found = await lookupDutchAddress(input.postalCode, hn!, signal);
    const street = input.addressLine1.slice(0, -hn!.length).trim().toLowerCase();
    const hit = found.find((c) => c.addressLine1.toLowerCase().startsWith(street)) ?? found[0];
    if (hit) return { lon: hit.lon, lat: hit.lat, label: hit.label, precision: "exact" };
  }

  if (!key) throw new Error("No MapTiler key configured");
  const query = [input.addressLine1, input.city].map((p) => p.trim()).filter(Boolean).join(", ");
  if (!input.addressLine1.trim()) return null;

  const centre = await postcodeCentre(input.postalCode, input.country, key, signal);
  const params: Record<string, string> = {
    country: input.country.toLowerCase(),
    types: LOCATABLE_TYPES,
    limit: "5",
  };
  if (centre) params.proximity = `${centre[0]},${centre[1]}`;
  const body = await getJson<{ features?: MaptilerFeature[] }>(maptilerUrl(query, key, params), signal);

  const near = nearPostcode(body.features ?? [], input.postalCode, centre).filter((f) => {
    // Without a postcode to anchor to, the typed city has to match instead.
    if (centre) return true;
    const city = contextText(f, "place", "locality", "municipality", "municipal_district") ?? f.text ?? "";
    return input.city.trim() !== "" && city.toLowerCase().includes(input.city.trim().toLowerCase());
  });
  // The match has to be about what the host typed, not just the town: for an
  // unknown street the geocoder falls back to the city, and a pin in the
  // middle of Saturnia is not "Località Follonata".
  const f = near.find((x) => sharesName(input.addressLine1, x.text ?? ""));
  if (!f?.center) return null;

  const exact = !!parsed && !!f.address && parseHouseNumber(f.address)?.number === parsed.number;
  return {
    lon: f.center[0],
    lat: f.center[1],
    label: f.place_name ?? f.text ?? query,
    precision: exact ? "exact" : "approximate",
  };
}
