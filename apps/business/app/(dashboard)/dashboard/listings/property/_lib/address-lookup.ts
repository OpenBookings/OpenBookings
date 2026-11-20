import { tomtomSearchUrl, type TomtomResult, type TomtomSearchParams } from "@openbookings/maps";
import { COUNTRIES } from "./countries";

/**
 * Finding a property's address, and placing an address on the map.
 *
 * Two jobs, two entry points:
 *
 * - `searchProperty`: the host types their property's name ("Terme di
 *   Saturnia", "Hotel Okura Amsterdam") and picks it. TomTom's points of
 *   interest carry a structured address, so one pick fills the address *and*
 *   places the pin on the building rather than on the street. A named place
 *   without a street — a rural estate — comes back with that line missing, and
 *   the editor opens the address lines for the host to complete.
 *
 * - `locateTypedAddress`: the host edited the address lines by hand. The pin
 *   follows the address, so the typed address is placed — exactly where it can
 *   be, approximately where only the street is known, and not at all when no
 *   result is about what was typed. A Dutch postcode + number goes to PDOK (the
 *   government's BAG register, exact for every Dutch address) through our own
 *   /api/address-lookup/nl, so the host's browser never talks to a vendor the
 *   privacy policy does not list. Everything else goes to TomTom, already
 *   our map vendor.
 *
 * TomTom's terms (11.4, 11.6) forbid storing its results. Nothing here is
 * saved: a result only fills the form, and what is saved is what the host
 * confirms there. Never persist TomTom ids, labels or raw responses, and never
 * cache results on a server.
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

// ── TomTom ─────────────────────────────────────────────────────────────────

/** Every country a property can be in, as TomTom's comma-separated filter. */
const SEARCH_COUNTRIES = COUNTRIES.map((c) => c.code.toUpperCase()).join(",");

async function search(
  query: string,
  key: string,
  params: TomtomSearchParams,
  signal: AbortSignal,
): Promise<TomtomResult[]> {
  const url = tomtomSearchUrl(query, key, params);
  if (!url) throw new Error("No TomTom key configured");
  const body = await getJson<{ results?: TomtomResult[] }>(url, signal);
  return body.results ?? [];
}

/**
 * A result's postcode. In NL `postalCode` holds only the digits ("1072"), so
 * the full code comes from `extendedPostalCode`, which for a street spanning
 * several postcodes is a list: take the first.
 */
function resultPostcode(r: TomtomResult): string {
  return r.address.extendedPostalCode?.split(",")[0]?.trim() || r.address.postalCode || "";
}

/** "The Leading Hotels of the World Hotel Okura Amsterdam" → "Hotel Okura Amsterdam". */
function poiName(r: TomtomResult): string | undefined {
  const name = r.poi?.name?.trim();
  const brand = r.poi?.brands?.[0]?.name;
  if (name && brand && name.startsWith(`${brand} `)) return name.slice(brand.length + 1).trim() || name;
  return name || undefined;
}

/** A search result as an address the host can confirm. */
export function propertyCandidate(r: TomtomResult): AddressCandidate | null {
  const a = r.address;
  const country = (a.countryCode ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !r.position) return null;

  const isPoi = r.type === "POI";
  const name = (isPoi ? poiName(r) : undefined) ?? a.streetName ?? a.freeformAddress;
  if (!name) return null;

  const street = r.type === "Geography" ? undefined : a.streetName;
  const addressLine1 = [street, street ? a.streetNumber : undefined].filter(Boolean).join(" ");
  const rawPostcode = resultPostcode(r);
  const postalCode = rawPostcode ? formatPostcode(rawPostcode, country) : "";
  const city = a.localName ?? a.municipality ?? "";

  const missing = (
    [
      ["addressLine1", addressLine1],
      ["postalCode", postalCode],
      ["city", city],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const label = isPoi && a.freeformAddress ? `${name}, ${a.freeformAddress}` : (a.freeformAddress ?? name);
  return {
    id: r.id ?? `${label}-${r.position.lon},${r.position.lat}`,
    name,
    label,
    addressLine1,
    postalCode,
    city,
    country,
    lon: r.position.lon,
    lat: r.position.lat,
    missing,
  };
}

function candidates(results: TomtomResult[]): AddressCandidate[] {
  const seen = new Set<string>();
  return results
    .map(propertyCandidate)
    .filter((c): c is AddressCandidate => {
      if (!c || seen.has(c.label.toLowerCase())) return false;
      seen.add(c.label.toLowerCase());
      return true;
    });
}

/** Property or place name → candidates anywhere a property can be. */
export async function searchProperty(query: string, key: string, signal: AbortSignal): Promise<AddressCandidate[]> {
  const results = await search(query.trim(), key, { idxSet: "POI,PAD,Addr,Geo", countrySet: SEARCH_COUNTRIES, limit: 8 }, signal);
  return candidates(results);
}

/** Addresses only (no hotels or places), for the onboarding autocomplete. */
export async function searchAddresses(query: string, key: string, signal: AbortSignal): Promise<AddressCandidate[]> {
  const results = await search(query.trim(), key, { idxSet: "PAD,Addr", countrySet: SEARCH_COUNTRIES, limit: 5 }, signal);
  return candidates(results);
}

// ── Typed address → pin ────────────────────────────────────────────────────

/**
 * How far a result may sit from the postcode's centre and still count as "in
 * this postcode". Rural postcodes are large: 58014 spans Manciano and
 * Saturnia, whose spa lies 5 km from the postcode's centre point.
 */
const NEAR_POSTCODE_KM = 15;

/** Areas too large to be a property's location. */
const REGION_ENTITIES = new Set(["Country", "CountrySubdivision", "CountrySecondarySubdivision"]);

export function distanceKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Keep results that belong to this postcode: inside it by their own address,
 * or near its centre when they carry no postcode at all. Without a postcode
 * centre, the country filter on the request is all there is.
 */
export function nearPostcode(
  results: TomtomResult[],
  postcode: string,
  centre: [number, number] | null,
): TomtomResult[] {
  const want = normalizePostcode(postcode);
  return results.filter((r) => {
    if (!r.position || (r.type === "Geography" && REGION_ENTITIES.has(r.entityType ?? ""))) return false;
    const at: [number, number] = [r.position.lon, r.position.lat];
    const pc = resultPostcode(r);
    if (want && pc) return normalizePostcode(pc) === want || (!!centre && distanceKm(centre, at) <= NEAR_POSTCODE_KM);
    return !centre || distanceKm(centre, at) <= NEAR_POSTCODE_KM;
  });
}

async function postcodeCentre(
  postcode: string,
  country: string,
  key: string,
  signal: AbortSignal,
): Promise<[number, number] | null> {
  if (!postcode.trim()) return null;
  const [hit] = await search(postcode.trim(), key, { idxSet: "Geo,EPP", countrySet: country.toUpperCase(), limit: 1 }, signal);
  return hit?.position ? [hit.position.lon, hit.position.lat] : null;
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

/**
 * Whether the house number found is the one typed. Only the leading number
 * counts: TomTom writes "1870/16" and "2/B" where the host typed "1870" or "2b".
 */
export function isExactNumber(found: string | undefined, typed: string): boolean {
  const lead = (v: string) => /^\s*(\d+)/.exec(v)?.[1];
  const f = found ? lead(found) : undefined;
  return !!f && f === lead(typed);
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

  if (!key) throw new Error("No TomTom key configured");
  const query = [input.addressLine1, input.city].map((p) => p.trim()).filter(Boolean).join(", ");
  if (!input.addressLine1.trim()) return null;

  const country = input.country.toUpperCase();
  const centre = await postcodeCentre(input.postalCode, country, key, signal);
  const results = await search(
    query,
    key,
    {
      idxSet: "PAD,Addr,Str,Geo,POI",
      countrySet: country,
      limit: 5,
      ...(centre ? { lon: centre[0], lat: centre[1] } : {}),
    },
    signal,
  );

  const near = nearPostcode(results, input.postalCode, centre).filter((r) => {
    // Without a postcode to anchor to, the typed city has to match instead.
    if (centre) return true;
    const city = r.address.localName ?? r.address.municipality ?? "";
    return input.city.trim() !== "" && city.toLowerCase().includes(input.city.trim().toLowerCase());
  });
  // The match has to be about what the host typed, not just the town: for an
  // unknown street the search falls back to the town, and a pin in the
  // middle of Saturnia is not "Località Follonata".
  const r = near.find((x) => sharesName(input.addressLine1, [x.poi?.name, x.address.streetName].filter(Boolean).join(" ")));
  if (!r?.position) return null;

  const exact = !!parsed && (r.type === "Point Address" || r.type === "POI") && isExactNumber(r.address.streetNumber, parsed.number);
  return {
    lon: r.position.lon,
    lat: r.position.lat,
    label: r.address.freeformAddress ?? query,
    precision: exact ? "exact" : "approximate",
  };
}
