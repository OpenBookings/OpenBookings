/**
 * End-to-end check of the Scaleway Object Storage wiring: credentials, CORS,
 * a presigned PUT, and a public read back through MEDIA_BASE_URL.
 *
 * Run from apps/business (bun auto-loads .env.local):
 *   bun scripts/check-storage.ts
 */
import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3_ENDPOINT, SCW_REGION, getBucketName, getS3, publicUrl } from "../lib/s3";

const required = ["SCW_ACCESS_KEY", "SCW_SECRET_KEY", "SCW_BUCKET_NAME"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`✗ missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const s3 = getS3();
const Bucket = getBucketName();
const key = `uploads/_healthcheck-${Date.now()}.png`;

// 1x1 transparent PNG — small enough that a failed cleanup costs nothing.
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

console.log(`region   ${SCW_REGION}\nendpoint ${S3_ENDPOINT}\nbucket   ${Bucket}\n`);

// ListObjectsV2 rather than HeadBucket: Scaleway refuses HeadBucket to scoped
// application keys, so it would fail here even when uploads work fine.
await s3.send(new ListObjectsV2Command({ Bucket, MaxKeys: 1 }));
console.log("✓ credentials valid, bucket reachable");

try {
  const cors = await s3.send(new GetBucketCorsCommand({ Bucket }));
  console.log("✓ CORS rules:", JSON.stringify(cors.CORSRules));
} catch {
  console.warn("⚠ CORS unreadable with this key — check it in the console");
}

const uploadUrl = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket, Key: key, ContentType: "image/png" }),
  { expiresIn: 600 },
);
console.log("✓ presigned PUT minted");

const put = await fetch(uploadUrl, {
  method: "PUT",
  headers: { "Content-Type": "image/png" },
  body: pixel,
});
if (!put.ok) {
  console.error(`✗ PUT failed ${put.status}: ${await put.text()}`);
  process.exit(1);
}
console.log("✓ upload via presigned URL succeeded");

const url = publicUrl(key);
const get = await fetch(url);
console.log(
  get.ok
    ? `✓ public read OK — ${url}`
    : `✗ public read ${get.status} — ${url}\n  bucket policy or Edge Services domain not serving this object`,
);

await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
console.log("✓ cleaned up test object");
