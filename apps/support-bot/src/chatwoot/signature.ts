import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Chatwoot's webhook HMAC: hex-encoded SHA-256 of the raw request body
 * keyed with the webhook secret, sent in `X-Chatwoot-Signature`. Constant-time
 * compare; missing/malformed headers verify false rather than throw.
 */
export function verifyChatwootSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureHeader, "hex");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
