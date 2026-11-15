import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EmailKind =
  | "booking_confirmed_guest"
  | "booking_new_host"
  | "review_invitation"
  | "review_reminder"
  | "stays_unconfirmed_host"
  | "team_invitation"
  | "support_reply"
  | "commission_invoice";

export type TrackingToken = {
  v: 1;
  /** send id */
  s: string;
  k: EmailKind;
  /** user id, null for emails tracked without consent */
  u: string | null;
  /** sent at, epoch seconds */
  t: number;
  /** link name (click tokens) */
  l?: string;
  /** destination (click tokens) */
  d?: string;
};

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM; output is base64url(iv || ciphertext || tag). */
export function sealToken(payload: TrackingToken, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64url");
}

/** Returns null for anything malformed, tampered, sealed with another key, or v !== 1. */
export function openToken(token: string, key: Buffer): TrackingToken | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as TrackingToken;
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}
