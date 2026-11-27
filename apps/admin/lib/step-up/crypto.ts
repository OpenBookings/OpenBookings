import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { StepUpConfigError } from "./config";

/**
 * How authenticator-app seeds are stored: encrypted with AES-256 in GCM mode,
 * keyed by ADMIN_TOTP_KEY (32 bytes, base64), as `v1:<iv>:<tag>:<ciphertext>`, each part base64. The database
 * never sees the key, so a leaked row is not a usable second factor.
 */

const VERSION = "v1";

function keyBytes(key: string): Buffer {
  if (!key.trim()) throw new StepUpConfigError("ADMIN_TOTP_KEY is not set: authenticator apps need it");
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32) throw new StepUpConfigError("ADMIN_TOTP_KEY must be 32 bytes, base64-encoded");
  return bytes;
}

export function encryptSecret(plain: string, key: string): string {
  const k = keyBytes(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** Throws on a wrong key, a tampered value or an unknown format. */
export function decryptSecret(enc: string, key: string): string {
  const k = keyBytes(key);
  const [version, iv, tag, ct, ...rest] = enc.split(":");
  if (version !== VERSION || !iv || !tag || ct === undefined || rest.length > 0) {
    throw new Error("Not an encrypted secret");
  }
  // A 16-byte tag only: GCM would otherwise accept a truncated one.
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}
