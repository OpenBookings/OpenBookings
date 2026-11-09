/** Helpers shared by the review modules (kept apart so they don't import each other). */
import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "../reservation-policy";

/** 32 random bytes as base64url: always 43 characters. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** What shows publicly as the author: the first word of the account name. */
export function firstName(name: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 40) || "Guest";
}

// ── Tokens ────────────────────────────────────────────────────────────────────

export function hashReviewToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** A new emailed link for `bookingId`. Returns the raw token; only its hash is stored. */
export async function createReviewToken(db: Queryable, bookingId: string, expiresAt: Date): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(`INSERT INTO review_tokens (token_hash, booking_id, expires_at) VALUES ($1, $2::uuid, $3)`, [
    hashReviewToken(token),
    bookingId,
    expiresAt,
  ]);
  return token;
}

export async function deleteReviewToken(db: Queryable, token: string): Promise<void> {
  await db.query(`DELETE FROM review_tokens WHERE token_hash = $1`, [hashReviewToken(token)]);
}

/**
 * The booking an emailed link points at, or null when the link is malformed,
 * unknown or expired. Reading never uses the token up: mail scanners open
 * links before the guest does. A token is spent by its booking getting a
 * review, which the review's unique booking_id enforces.
 */
export async function bookingForReviewToken(db: Queryable, token: string, now: Date): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const row = (
    await db.query(`SELECT booking_id FROM review_tokens WHERE token_hash = $1 AND expires_at > $2`, [
      hashReviewToken(token),
      now,
    ])
  ).rows[0] as { booking_id: string } | undefined;
  return row?.booking_id ?? null;
}

