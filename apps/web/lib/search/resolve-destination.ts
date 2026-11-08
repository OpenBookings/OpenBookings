import { cached } from "@openbookings/cache";
import { ALGOLIA_INDEX_NAME, searchClient } from "@/lib/algolia";

export type ResolvedDestination = { lat: number; lon: number; city: string; country: string };

/** One hit of the Algolia "Cities" index, as the destination box reads it. */
export type CityHit = {
  city: string;
  city_ascii?: string;
  lat: number;
  lng: number;
  country?: string;
  iso2?: string;
  admin_name?: string;
  population?: number | string | null;
  objectID?: string;
};

type Cache = <T>(key: string, load: () => Promise<T | null>) => Promise<T | null>;

const EU = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

const THIRTY_DAYS = 30 * 24 * 3600;

const norm = (s: string | undefined | null) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

async function algoliaSearch(query: string): Promise<CityHit[]> {
  const res = await searchClient.search<CityHit>({
    requests: [{ indexName: ALGOLIA_INDEX_NAME, query, hitsPerPage: 20 }],
  });
  const first = res.results[0] as { hits?: CityHit[] } | undefined;
  return first?.hits ?? [];
}

const defaultCache: Cache = (key, load) =>
  cached(key, load, { freshSeconds: THIRTY_DAYS, maxAgeSeconds: THIRTY_DAYS });

const population = (h: CityHit) => {
  const n = Number(h.population);
  return Number.isFinite(n) ? n : 0;
};

function pick(hits: CityHit[], cityPart: string, countryPart: string): CityHit | null {
  const usable = hits.filter((h) => {
    if (typeof h.city !== "string") return false;
    if (!Number.isFinite(Number(h.lat)) || !Number.isFinite(Number(h.lng))) return false;
    if (h.iso2 && !EU.has(h.iso2.toUpperCase())) return false;
    if (countryPart && norm(h.country) !== countryPart && norm(h.iso2) !== countryPart) return false;
    return true;
  });
  const exact = usable.filter((h) => norm(h.city) === cityPart || norm(h.city_ascii) === cityPart);
  if (exact.length > 0) return exact.reduce((best, h) => (population(h) > population(best) ? h : best));
  return usable[0] ?? null;
}

export async function resolveDestination(
  text: string,
  deps: { search?: (query: string) => Promise<CityHit[]>; cache?: Cache } = {},
): Promise<ResolvedDestination | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const comma = trimmed.lastIndexOf(",");
  const cityRaw = (comma >= 0 ? trimmed.slice(0, comma) : trimmed).trim();
  const countryPart = comma >= 0 ? norm(trimmed.slice(comma + 1)) : "";
  if (!cityRaw) return null;
  const cityPart = norm(cityRaw);

  const search = deps.search ?? algoliaSearch;
  const cache = deps.cache ?? defaultCache;
  try {
    return await cache<ResolvedDestination>(`destination:v1:${norm(trimmed)}`, async () => {
      const hit = pick(await search(cityRaw), cityPart, countryPart);
      return hit
        ? { lat: Number(hit.lat), lon: Number(hit.lng), city: hit.city, country: hit.country ?? "" }
        : null;
    });
  } catch (err) {
    console.error("[search] destination lookup:", err instanceof Error ? err.message : err);
    return null;
  }
}
