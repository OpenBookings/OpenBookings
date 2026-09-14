import { S3Client } from "@aws-sdk/client-s3";

declare global {
  var __scwS3: S3Client | undefined;
}

export const SCW_REGION = process.env.SCW_REGION ?? "nl-ams";

/**
 * Scaleway Object Storage speaks S3, so the AWS SDK drives it unchanged — only
 * the endpoint has to be pointed away from Amazon.
 */
export const S3_ENDPOINT = `https://s3.${SCW_REGION}.scw.cloud`;

function createClient(): S3Client {
  return new S3Client({
    region: SCW_REGION,
    endpoint: S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.SCW_ACCESS_KEY!,
      secretAccessKey: process.env.SCW_SECRET_KEY!,
    },
  });
}

const s3: S3Client = globalThis.__scwS3 ?? createClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__scwS3 = s3;
}

export function getS3() {
  return s3;
}

export function getBucketName() {
  return process.env.SCW_BUCKET_NAME!;
}

/**
 * Where a stored object is readable from. Reads go through the Edge Services
 * custom domain when one is configured; the bucket's own endpoint is the
 * fallback so an unset MEDIA_BASE_URL yields a slower URL, not a broken one.
 */
export function publicUrl(key: string) {
  const base = process.env.MEDIA_BASE_URL?.replace(/\/+$/, "");
  return base
    ? `${base}/${key}`
    : `https://${getBucketName()}.s3.${SCW_REGION}.scw.cloud/${key}`;
}
