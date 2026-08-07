import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Chatwoot's webhook HMAC.
 *
 * Chatwoot signs the timestamp together with the body, not the body alone:
 *
 *   X-Chatwoot-Signature: sha256=<hex HMAC-SHA256(secret, "{timestamp}.{raw_body}")>
 *   X-Chatwoot-Timestamp: <unix seconds>
 *
 * Binding the timestamp is what makes the signature non-replayable, so a
 * captured request is only accepted inside `toleranceSeconds` (Chatwoot
 * recommends 5 minutes). `raw_body` must be the bytes as received — parsing
 * and re-serializing changes the digest.
 *
 * Everything is fail-closed: missing, malformed, or stale headers verify
 * false rather than throw.
 */

/** Chatwoot's recommended replay window. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

export function verifyChatwootSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; nowMs?: number } = {},
): boolean {
  if (!signatureHeader || !timestampHeader) return false;

  // Must be a plain unix-seconds integer. Reject anything else rather than
  // letting Number() coerce "" or "12abc" into something usable.
  const timestamp = timestampHeader.trim();
  if (!/^\d+$/.test(timestamp)) return false;

  const tolerance = opts.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  // Absolute skew: guards replay of an old capture, and refuses far-future
  // timestamps that would otherwise stay valid for a long time.
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) return false;

  // Chatwoot prefixes the digest with the algorithm; tolerate a bare hex
  // digest too, since not every version sends the prefix.
  const provided = signatureHeader.trim().replace(/^sha256=/i, "");
  // Buffer.from(_, "hex") truncates at the first invalid pair instead of
  // throwing, so the shape is checked up front rather than caught.
  if (!HEX_SHA256.test(provided)) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest();

  return timingSafeEqual(Buffer.from(provided, "hex"), expected);
}
