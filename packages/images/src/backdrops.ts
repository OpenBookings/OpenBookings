export type Backdrop = { id: string; name: string; url: string };

const BASE = "https://cdn.openbookings.co/Public/backgrounds";

/**
 * The list of backdrops lives next to the photos, so adding one is an upload
 * plus an edit to this file, with no deploy. Shape:
 *   { "backdrops": [{ "id": "italy-rome", "name": "Rome", "file": "Italy-Rome.avif" }] }
 */
export const BACKDROP_MANIFEST_URL = `${BASE}/manifest.json`;

/** Holds the visitor's backdrop id, so the server can render the same one every visit. */
export const BACKDROP_COOKIE = "ob_backdrop";

const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

function isSafeFile(file: string): boolean {
  return file.length > 0 && !file.includes("/") && !file.includes("\\") && !file.includes("..");
}

/**
 * Turns the manifest into backdrops. Bad entries are dropped instead of
 * failing the whole list, because one typo in a hand-edited file should not
 * blank every page. If two entries share an id, the first one is kept.
 */
export function parseBackdropManifest(json: unknown): Backdrop[] {
  if (typeof json !== "object" || json === null) return [];
  const entries = (json as { backdrops?: unknown }).backdrops;
  if (!Array.isArray(entries)) return [];

  const seen = new Set<string>();
  const backdrops: Backdrop[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name, file } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !ID_PATTERN.test(id) || seen.has(id)) continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (typeof file !== "string" || !isSafeFile(file)) continue;
    seen.add(id);
    backdrops.push({ id, name: name.trim(), url: `${BASE}/${encodeURIComponent(file)}` });
  }
  return backdrops;
}

/**
 * The backdrop a visitor should see, given the id their cookie remembered.
 * `persist` tells the caller to write the id back to the cookie.
 *
 * A remembered id is only trusted if it is still in the list: the cookie
 * outlives manifest edits, so a removed photo must not stick.
 */
export function pickBackdrop(
  list: readonly Backdrop[],
  storedId: string | null | undefined,
  random: () => number = Math.random,
): { backdrop: Backdrop | null; persist: boolean } {
  if (list.length === 0) return { backdrop: null, persist: false };
  const known = storedId ? list.find((b) => b.id === storedId) : undefined;
  if (known) return { backdrop: known, persist: false };
  const index = Math.min(list.length - 1, Math.floor(random() * list.length));
  return { backdrop: list[index], persist: true };
}
