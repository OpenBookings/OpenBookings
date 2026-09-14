/**
 * End-to-end check of the Cloudflare R2 wiring: credentials, CORS, a presigned
 * PUT, and a public read back through MEDIA_BASE_URL.
 *
 * Run from apps/business (bun auto-loads .env.local):
 *   bun scripts/check-storage.ts
 */
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2_REGION, S3_ENDPOINT, getBucketName, getS3, publicUrl } from "../lib/s3";

const required = [
  "R2_ENDPOINT",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "MEDIA_BASE_URL",
  // The origin the browser will actually send on the upload PUT, so the CORS
  // preflight below tests the real thing rather than a guess.
  "NEXT_PUBLIC_APP_URL",
];
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

console.log(`region   ${R2_REGION}\nendpoint ${S3_ENDPOINT}\nbucket   ${Bucket}\n`);

// ListObjectsV2 rather than HeadBucket: an Object Read & Write token is not
// allowed to HeadBucket, so that would fail here even when uploads work fine.
// A NoSuchBucket here usually means the endpoint is missing the bucket's
// jurisdiction prefix (`.eu.`) rather than the bucket being absent.
await s3.send(new ListObjectsV2Command({ Bucket, MaxKeys: 1 }));
console.log("✓ credentials valid, bucket reachable");

const uploadUrl = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket, Key: key, ContentType: "image/png" }),
  { expiresIn: 600 },
);
console.log("✓ presigned PUT minted");

// The upload runs in the browser, so CORS decides whether it works at all —
// and it is invisible to every other step here, because a server-side PUT
// sends no Origin and is never preflighted. Reading the bucket's CORS config
// instead would not do: that needs an Admin token, so a scoped object token
// gets AccessDenied and the check degrades to a shrug. Ask R2 the same
// question the browser asks.
const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL!).origin;

async function preflight(origin: string) {
  const res = await fetch(uploadUrl, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  return { ok: res.ok, allow: res.headers.get("access-control-allow-origin") };
}

const cors = await preflight(appOrigin);
if (!cors.ok || cors.allow !== appOrigin) {
  console.error(
    `✗ CORS rejects ${appOrigin} — browser uploads will fail\n` +
      `  add it to the bucket's CORS policy (R2 dashboard -> ${Bucket} -> Settings)\n` +
      `  note the scheme: http and https are different origins to CORS`,
  );
  process.exit(1);
}
console.log(`✓ CORS preflight OK for ${appOrigin}`);

// A policy that echoes back an origin nobody configured is a wildcard. Signing
// still gates writes, so this is a warning rather than a failure.
const stranger = await preflight("https://cors-probe.invalid");
if (stranger.ok && stranger.allow) {
  console.warn(`⚠ CORS also allows https://cors-probe.invalid — policy looks wildcarded`);
}

// Origin included so this exercises the same request the browser sends.
const put = await fetch(uploadUrl, {
  method: "PUT",
  headers: { Origin: appOrigin, "Content-Type": "image/png" },
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
    : `✗ public read ${get.status} — ${url}\n  custom domain not attached to this bucket, or not yet propagated`,
);

await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
console.log("✓ cleaned up test object");
