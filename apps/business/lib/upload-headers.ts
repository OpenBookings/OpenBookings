/**
 * Upload keys are random UUIDs, so the bytes at a URL never change and can be
 * cached for as long as HTTP allows.
 */
export const UPLOAD_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * The headers a presigned upload PUT must send. Both are signed into the URL,
 * so the browser has to send these exact values or R2 rejects the signature.
 */
export function uploadHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": UPLOAD_CACHE_CONTROL,
  };
}
