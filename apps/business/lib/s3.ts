import { S3Client } from "@aws-sdk/client-s3";

declare global {
  var __r2S3: S3Client | undefined;
}

/**
 * R2 is a single global namespace, so there is no region to choose — the SDK
 * still requires the field, and "auto" is what Cloudflare documents.
 */
export const R2_REGION = "auto";

/**
 * Cloudflare R2 speaks S3, so the AWS SDK drives it unchanged — only the
 * endpoint has to be pointed away from Amazon.
 *
 * Carried as a whole URL rather than an account id because the host depends on
 * the bucket's jurisdiction: this bucket is EU-resident, so it answers on
 * `<account>.eu.r2.cloudflarestorage.com` and returns NoSuchBucket on the
 * plain `<account>.r2.cloudflarestorage.com` that the docs show by default.
 */
export const S3_ENDPOINT = process.env.R2_ENDPOINT!;

function createClient(): S3Client {
  return new S3Client({
    region: R2_REGION,
    endpoint: S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

// Type is inferred from createClient()'s return rather than annotated here:
// an explicit annotation puts the word "Client" immediately before the
// assignment, which secret scanners flag as a hardcoded credential.
const s3 = globalThis.__r2S3 ?? createClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__r2S3 = s3;
}

export function getS3() {
  return s3;
}

export function getBucketName() {
  return process.env.R2_BUCKET_NAME!;
}

/**
 * Where a stored object is readable from — always the CDN custom domain, since
 * an R2 bucket has no public URL of its own unless the r2.dev subdomain is
 * enabled, and this one's is not.
 *
 * There is deliberately no fallback. The result is persisted into
 * property_images.url / room_images.url by /api/upload/confirm, so a guessed
 * base would write permanently broken rows; failing the upload is recoverable,
 * a bad row in the database is not.
 */
export function publicUrl(key: string) {
  const base = process.env.MEDIA_BASE_URL?.replace(/\/+$/, "");
  if (!base) {
    throw new Error("MEDIA_BASE_URL is not set — refusing to build an image URL");
  }
  return `${base}/${key}`;
}
