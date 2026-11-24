/**
 * App installations (0060): one connected app per property, with a per-property
 * API key. Only the key's hash and last four characters are stored; the key
 * itself is shown once, by `connectApp`.
 */
import { createHash } from "node:crypto";
import { todayInZone } from "@openbookings/pricing";
import type { Queryable } from "../reservation-policy";

export type Installation = {
  id: string;
  propertyId: string;
  appKey: "siteminder";
  status: "active" | "disconnected";
  connectedAt: string;
};

const KEY_ALPHABET = [..."0123456789", ...range("A", 26), ...range("a", 26)].join("");

function range(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, n) => String.fromCharCode(first.charCodeAt(0) + n));
}
const KEY_BODY_LENGTH = 40;

/** `obk_` + 40 characters [A-Za-z0-9], drawn without modulo bias. */
export function generateAppKey(): string {
  // 248 = 62 * 4: bytes at or above it are dropped so every character is equally likely.
  const limit = 248;
  let body = "";
  while (body.length < KEY_BODY_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(KEY_BODY_LENGTH * 2))) {
      if (byte >= limit) continue;
      body += KEY_ALPHABET[byte % KEY_ALPHABET.length];
      if (body.length === KEY_BODY_LENGTH) break;
    }
  }
  return `obk_${body}`;
}

export function hashAppKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

type InstallationRow = {
  id: string;
  property_id: string;
  app_key: "siteminder";
  status: "active" | "disconnected";
  connected_at: Date;
};

const INSTALLATION_COLUMNS = `id, property_id, app_key, status, connected_at`;

function toInstallation(row: InstallationRow): Installation {
  return {
    id: row.id,
    propertyId: row.property_id,
    appKey: row.app_key,
    status: row.status,
    connectedAt: row.connected_at.toISOString(),
  };
}

/** Bookings that still matter to the hotel: confirmed or checked in, check-out today or later (property time). */
const upcomingBookings = (propertyParam: string, todayParam: string) => `
  SELECT b.id
    FROM bookings b
   WHERE b.hotel_id = ${propertyParam}::uuid
     AND b.status IN ('confirmed', 'checked_in')
     AND b.check_out_date >= ${todayParam}::date`;

/**
 * Connect an app to a property and issue its key.
 *
 * Pass a transaction (the same convention as the other modules): everything
 * here commits or rolls back together. The property row is locked first, so two
 * concurrent connects for one property run one after the other; the second sees
 * the first's active installation and replaces its key. The partial unique
 * index on active installations stays the backstop.
 *
 * A disconnected installation of the same app is reused (same id), so delivery
 * rows and acknowledgements survive a reconnect. With `sendUpcoming` false,
 * every upcoming booking without a `delivered` row is marked `not_sent`.
 */
export async function connectApp(
  db: Queryable,
  i: { propertyId: string; appKey: "siteminder"; userId: string; sendUpcoming: boolean; now: Date },
): Promise<{ installation: Installation; apiKey: string; notSentCount: number }> {
  const locked = (
    await db.query(`SELECT timezone FROM properties WHERE id = $1::uuid FOR UPDATE`, [i.propertyId])
  ).rows[0] as { timezone: string } | undefined;
  if (!locked) throw new Error(`Property ${i.propertyId} not found`);
  const today = todayInZone(locked.timezone, i.now);

  const apiKey = generateAppKey();
  const keyHash = hashAppKey(apiKey);
  const keyLast4 = apiKey.slice(-4);

  const existing = (
    await db.query(
      `SELECT id FROM app_installations
        WHERE property_id = $1::uuid AND app_key = $2
        ORDER BY (status = 'active') DESC, connected_at DESC
        LIMIT 1
        FOR UPDATE`,
      [i.propertyId, i.appKey],
    )
  ).rows[0] as { id: string } | undefined;

  let row: InstallationRow;
  if (existing) {
    row = (
      await db.query(
        `UPDATE app_installations
            SET status = 'active', key_hash = $2, key_last4 = $3, connected_at = $4,
                connected_by = $5, disconnected_at = NULL
          WHERE id = $1::uuid
        RETURNING ${INSTALLATION_COLUMNS}`,
        [existing.id, keyHash, keyLast4, i.now, i.userId],
      )
    ).rows[0] as InstallationRow;
  } else {
    row = (
      await db.query(
        `INSERT INTO app_installations (property_id, app_key, status, key_hash, key_last4, connected_at, connected_by)
         VALUES ($1::uuid, $2, 'active', $3, $4, $5, $6)
         RETURNING ${INSTALLATION_COLUMNS}`,
        [i.propertyId, i.appKey, keyHash, keyLast4, i.now, i.userId],
      )
    ).rows[0] as InstallationRow;
  }

  let notSentCount = 0;
  if (!i.sendUpcoming) {
    const marked = await db.query(
      `INSERT INTO app_booking_delivery (installation_id, booking_id, status, detail, updated_at)
       SELECT $1::uuid, u.id, 'not_sent', 'Not sent when the app was connected', $3
         FROM (${upcomingBookings("$2", "$4")}) u
       ON CONFLICT (installation_id, booking_id) DO UPDATE
          SET status = 'not_sent', detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at
        WHERE app_booking_delivery.status <> 'delivered'
       RETURNING booking_id`,
      [row.id, i.propertyId, i.now, today],
    );
    notSentCount = marked.rows.length;
  }

  return { installation: toInstallation(row), apiKey, notSentCount };
}

/** Switch an installation off. The row stays, so a reconnect keeps its id and delivery history. */
export async function disconnectApp(db: Queryable, i: { installationId: string; now: Date }): Promise<void> {
  await db.query(
    `UPDATE app_installations SET status = 'disconnected', disconnected_at = $2
      WHERE id = $1::uuid AND status = 'active'`,
    [i.installationId, i.now],
  );
}

/** The active installation holding this key, or null (wrong key, or disconnected). */
export async function installationForKey(db: Queryable, apiKey: string): Promise<Installation | null> {
  const row = (
    await db.query(
      `SELECT ${INSTALLATION_COLUMNS} FROM app_installations WHERE key_hash = $1 AND status = 'active'`,
      [hashAppKey(apiKey)],
    )
  ).rows[0] as InstallationRow | undefined;
  return row ? toInstallation(row) : null;
}

export async function activeInstallation(db: Queryable, propertyId: string): Promise<Installation | null> {
  const row = (
    await db.query(
      `SELECT ${INSTALLATION_COLUMNS} FROM app_installations WHERE property_id = $1::uuid AND status = 'active'`,
      [propertyId],
    )
  ).rows[0] as InstallationRow | undefined;
  return row ? toInstallation(row) : null;
}

/** Upcoming bookings of the property that the app has not been told about (no `delivered` row). */
export async function upcomingUndeliveredCount(db: Queryable, propertyId: string, today: string): Promise<number> {
  const row = (
    await db.query(
      `SELECT count(*)::int AS n
         FROM (${upcomingBookings("$1", "$2")}) u
        WHERE NOT EXISTS (
          SELECT 1 FROM app_booking_delivery d
           WHERE d.booking_id = u.id AND d.status = 'delivered'
        )`,
      [propertyId, today],
    )
  ).rows[0] as { n: number };
  return row.n;
}
