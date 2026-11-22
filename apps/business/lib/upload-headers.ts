/**
 * The presigned upload PUT, from both ends: what /api/upload/presign signs and
 * what the browser sends. They live together so the two cannot drift apart.
 *
 * Content-Type is signed into the URL (the presigner leaves it out by
 * default), so R2 rejects a PUT that sends any other type than the image type
 * the host declared. Without this, a URL minted for image/png would accept
 * text/html, and the media domain would serve it as a web page.
 *
 * Cache-Control is deliberately NOT signed: a signed header must be sent by
 * the browser, and a header the bucket's CORS policy does not list fails the
 * preflight. Caching for the media domain is set at the CDN instead.
 */
export const presignUpload = {
  expiresIn: 600,
  signableHeaders: new Set(["content-type"]),
};

/** The headers the browser's PUT to a presigned upload URL must send. */
export function uploadHeaders(contentType: string): Record<string, string> {
  return { "Content-Type": contentType };
}
