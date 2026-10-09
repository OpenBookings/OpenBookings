export type Backdrop = { url: string; name: string };

const BASE = "https://cdn.openbookings.co/Public/backgrounds";

// These are AVIF, which Cloudflare cannot resize on this plan, so they are
// served as-is. When JPEG or WebP masters are uploaded, change `file` here
// and nowhere else; `resolveBackdrop` moves returning visitors off the old
// URLs.
const FILES: { name: string; file: string }[] = [
  { name: "Sydney", file: "Australia-Sydney.avif" },
  { name: "Paris", file: "France-Paris.avif" },
  { name: "Honolulu", file: "Hawaii-Honolulu.avif" },
  { name: "Iceland", file: "Iceland-Reykjavik.avif" },
  { name: "Rome", file: "Italy-Rome.avif" },
  { name: "Osaka", file: "Japan-Osaka.avif" },
  { name: "Morroco", file: "Morroco-Chefchaouen.avif" },
  { name: "Amsterdam", file: "Netherlands-Amsterdam.avif" },
  { name: "San Francisco", file: "USA-SanFrancisco.avif" },
  { name: "Rio de Janeiro", file: "Brazil-RioDeJaneiro.avif" },
  { name: "Tuscany", file: "Italy-Tuscany.avif" },
  { name: "Lake Como", file: "Italy-LakeComo.avif" },
  { name: "New York City", file: "USA-NewYorkCity.avif" },
  { name: "Zermatt", file: "Switzerland-Zermatt.avif" },
  { name: "Sa Pa", file: "Vietnam-SaPa.avif" },
  { name: "Scotland", file: "UK-Scotland.avif" },
  { name: "Africa", file: "Africa-Safari.avif" },
  { name: "Iceland", file: "Iceland-Waterfall.avif" },
  { name: "Costa Rica", file: "Costa-Rica-Volcano.avif" },
  { name: "Patagonia", file: "Patagonia-Mountains.avif" },
];

export const BACKDROPS: readonly Backdrop[] = FILES.map(({ name, file }) => ({
  name,
  url: `${BASE}/${file}`,
}));

function pick(random: () => number): Backdrop {
  return BACKDROPS[Math.min(BACKDROPS.length - 1, Math.floor(random() * BACKDROPS.length))];
}

/**
 * The backdrop a visitor should see, given what their browser remembered.
 * `changed` tells the caller to write the result back to storage.
 *
 * A remembered backdrop is only trusted if its URL is still in the list:
 * storage outlives deploys, so a renamed file would otherwise leave returning
 * visitors with a broken image indefinitely.
 */
export function resolveBackdrop(
  stored: string | null,
  random: () => number = Math.random,
): { backdrop: Backdrop; changed: boolean } {
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      const url = typeof parsed === "object" && parsed !== null ? (parsed as { url?: unknown }).url : undefined;
      const known = BACKDROPS.find((b) => b.url === url);
      if (known) return { backdrop: known, changed: false };
    } catch {
      // Unparseable storage is treated the same as none.
    }
  }
  return { backdrop: pick(random), changed: true };
}
