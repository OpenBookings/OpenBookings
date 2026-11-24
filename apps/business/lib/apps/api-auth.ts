import { getPool } from "@openbookings/db";
import { installationForKey, type Installation } from "@openbookings/db/apps";

const KEY_RE = /^obk_[A-Za-z0-9]{40}$/;

/**
 * The installation behind `Authorization: Bearer obk_…`, or null (no header,
 * malformed key, wrong key, disconnected installation). Apps send no cookie:
 * the key is the only credential.
 */
export async function authenticateApp(request: Request): Promise<Installation | null> {
  const match = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match || !KEY_RE.test(match[1]!)) return null;
  return installationForKey(getPool(), match[1]!);
}

/** Every Apps API response: JSON, never cached. */
export function appsJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function unauthorized(): Response {
  return appsJson({ error: "unauthorized" }, 401);
}

/** The first zod issue as `path: message`. */
export function firstIssue(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return "invalid body";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * The request body as text, refused once it passes `maxBytes`: the declared
 * length is checked first, then the stream is cut off as soon as it exceeds
 * the cap, so an oversized body is never held in memory or parsed.
 * Returns null when too large.
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
