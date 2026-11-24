import { Receiver } from "@upstash/qstash";
import type { Context } from "hono";
import { alert, errorText } from "./alert";
import type { Queryable } from "./db/migrate";
import { env } from "./env";
import { type TickDeps, tick } from "./tick";

/** A doorbell body is `{ installationId }`; anything larger is not one. */
export const MAX_DOORBELL_BYTES = 4096;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when the request is a genuine QStash delivery of this exact body to this exact URL (QStash signs a JWT
 * binding both, so a captured delivery cannot be replayed elsewhere). False when the keys are unset.
 */
export async function verifyDoorbell(i: { rawBody: string; signature: string | undefined; url: string }): Promise<boolean> {
  const currentSigningKey = env.qstashCurrentSigningKey;
  const nextSigningKey = env.qstashNextSigningKey;
  if (!i.signature || !currentSigningKey || !nextSigningKey) return false;
  try {
    return await new Receiver({ currentSigningKey, nextSigningKey }).verify({
      signature: i.signature,
      body: i.rawBody,
      url: i.url,
      clockTolerance: 5,
    });
  } catch {
    return false;
  }
}

export type DoorbellDeps = {
  /** The public base URL when QStash is fully configured (both signing keys and the base URL), else undefined. */
  baseUrl: () => string | undefined;
  verify: typeof verifyDoorbell;
  tick: typeof tick;
};

export const defaultDoorbellDeps: DoorbellDeps = {
  baseUrl: () => (env.qstashCurrentSigningKey && env.qstashNextSigningKey ? env.serviceBaseUrl : undefined),
  verify: verifyDoorbell,
  tick,
};

/** The body as text, or null once it passes the cap (checked while reading, so a huge body is never buffered). */
async function readCapped(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DOORBELL_BYTES) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOORBELL_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function isActiveInstallation(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM siteminder.installations WHERE id = $1 AND status = 'active'`, [id]);
  return rows.length > 0;
}

/**
 * `POST /doorbell`: core rang through QStash, poll that installation right away. Never accepts an unsigned
 * doorbell; a malformed body or an unknown installation is answered like a valid one so ids cannot be probed.
 */
export async function handleDoorbell(c: Context, getDb: () => Queryable, tickDeps: () => TickDeps, deps: DoorbellDeps = defaultDoorbellDeps) {
  const baseUrl = deps.baseUrl();
  if (!baseUrl) return c.json({ error: "doorbell not configured" }, 503);

  const rawBody = await readCapped(c.req.raw);
  if (rawBody === null) return c.json({ error: "body too large" }, 413);
  const valid = await deps.verify({ rawBody, signature: c.req.header("upstash-signature"), url: `${baseUrl}/doorbell` });
  if (!valid) return c.json({ error: "invalid signature" }, 403);

  let installationId: unknown;
  try {
    installationId = (JSON.parse(rawBody) as { installationId?: unknown } | null)?.installationId;
  } catch {
    return c.body(null, 202);
  }
  if (typeof installationId !== "string" || !UUID.test(installationId)) return c.body(null, 202);
  if (!(await isActiveInstallation(getDb(), installationId))) return c.body(null, 202);

  // Not awaited: QStash only needs the 202, the poll can take as long as it takes.
  void deps.tick(tickDeps(), { installationId }).catch((e) => {
    alert("error", "tick for a doorbell failed", { installationId, error: errorText(e) });
  });
  return c.body(null, 202);
}
