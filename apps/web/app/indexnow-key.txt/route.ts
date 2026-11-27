// IndexNow proves a ping comes from the site's owner by fetching this file and
// comparing it with the key in the ping (apps/business/lib/indexnow.ts sends
// both, with this URL as `keyLocation`). The key is not a secret: anyone can
// read it here, and all it allows is asking search engines to recrawl our URLs.

// Read at runtime: the key is container config, not baked into the build.
export const dynamic = "force-dynamic";

/** IndexNow's own rule for a key: 8 to 128 of a-z, A-Z, 0-9 and "-". */
const KEY = /^[a-zA-Z0-9-]{8,128}$/;

export function GET() {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key || !KEY.test(key)) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  return new Response(key, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
