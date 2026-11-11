import { resolveDestination, type ResolvedDestination } from "@/lib/search/resolve-destination";

const DESTINATION_NOT_FOUND = "We couldn't find that destination. Try a city name.";

export type SearchTarget =
  | { ok: true; lat: string | null; lon: string | null; place: string | null }
  | { ok: false; errors: string[] };

/**
 * Where to search. Explicit lat/lon win; otherwise the destination (or the
 * older `place`) name is resolved on the server. With neither, the existing
 * coordinate validation reports what is missing.
 */
export async function resolveSearchTarget(
  params: URLSearchParams,
  resolve: (text: string) => Promise<ResolvedDestination | null> = resolveDestination,
): Promise<SearchTarget> {
  const name = (params.get("destination") || params.get("place") || "").trim().slice(0, 200) || null;
  const lat = params.get("lat") || null;
  const lon = params.get("lon") || null;
  if ((lat && lon) || !name) return { ok: true, lat, lon, place: name };

  const found = await resolve(name);
  if (!found) return { ok: false, errors: [DESTINATION_NOT_FOUND] };
  return { ok: true, lat: String(found.lat), lon: String(found.lon), place: found.city };
}
