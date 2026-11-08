import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStore } from "../steps/store";

/** The variables the invoice bucket is configured with. */
export type R2Env = Record<string, string | undefined>;

function required(env: R2Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required to store invoices`);
  return value;
}

/** A `Content-Disposition` filename that cannot break out of its quotes. */
const dispositionName = (filename: string) => filename.replace(/[^\w.\- ]/g, "_");

/**
 * The invoice bucket on Cloudflare R2, through the S3 API. Separate from the
 * media bucket: its own endpoint (the EU-jurisdiction host), keys and name
 * (`INVOICES_R2_ENDPOINT`, `INVOICES_R2_ACCESS_KEY_ID`,
 * `INVOICES_R2_SECRET_ACCESS_KEY`, `INVOICES_R2_BUCKET`). The sha256 of each
 * file is kept as object metadata (`sha256`, hex) and is what `head` returns,
 * because R2's own checksum support varies. Download links are presigned with
 * `Content-Disposition: attachment`. `client` is only for tests.
 */
export function createR2Store(env: R2Env, client?: Pick<S3Client, "send">): ObjectStore {
  const bucket = required(env, "INVOICES_R2_BUCKET");
  const s3 =
    client ??
    new S3Client({
      region: "auto",
      endpoint: required(env, "INVOICES_R2_ENDPOINT"),
      credentials: {
        accessKeyId: required(env, "INVOICES_R2_ACCESS_KEY_ID"),
        secretAccessKey: required(env, "INVOICES_R2_SECRET_ACCESS_KEY"),
      },
    });
  // Presigning needs a real client; with an injected test double it is never asked for.
  const signer = () => {
    if (!(s3 instanceof S3Client)) throw new Error("presign needs a real S3 client");
    return s3;
  };

  return {
    async head(key) {
      try {
        const out = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { sha256: out.Metadata?.sha256 ?? null };
      } catch (error) {
        const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async put(key, body, contentType, sha256) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, Metadata: { sha256 } }));
    },
    async get(key) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!out.Body) throw new Error(`Object ${key} has no body`);
      return out.Body.transformToByteArray();
    },
    presign(key, ttlSeconds, filename) {
      return getSignedUrl(
        signer(),
        new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: `attachment; filename="${dispositionName(filename)}"` }),
        { expiresIn: ttlSeconds },
      );
    },
  };
}
