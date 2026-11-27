import type { Queryable } from "../staff";

/**
 * A staff member's step-up credentials (admin_credentials, migration 0060):
 * passkeys and authenticator apps. What a page may show: never the TOTP
 * secret, which ob_admin_read cannot select anyway.
 */
export type CredentialKind = "passkey" | "totp";

export type AdminCredential = {
  id: string;
  kind: CredentialKind;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

const COLUMNS = `id, kind, label, created_at, last_used_at`;

const toCredential = (row: Record<string, unknown>): AdminCredential => ({
  id: String(row.id),
  kind: row.kind as CredentialKind,
  label: (row.label as string | null) ?? null,
  createdAt: row.created_at as Date,
  lastUsedAt: (row.last_used_at as Date | null) ?? null,
});

export async function listCredentials(db: Queryable, userId: string): Promise<AdminCredential[]> {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM admin_credentials WHERE user_id = $1 ORDER BY created_at, id`,
    [userId],
  );
  return rows.map(toCredential);
}

export async function hasCredentials(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM admin_credentials WHERE user_id = $1 LIMIT 1`, [userId]);
  return rows.length > 0;
}

/** Passkey ids already registered, so the browser does not register the same authenticator twice. */
export async function passkeyIds(db: Queryable, userId: string): Promise<{ id: string; transports: string[] }[]> {
  const { rows } = await db.query(
    `SELECT credential_id, transports FROM admin_credentials WHERE user_id = $1 AND kind = 'passkey'`,
    [userId],
  );
  return rows.map((r) => ({ id: String(r.credential_id), transports: (r.transports as string[] | null) ?? [] }));
}

export async function insertTotpCredential(
  db: Queryable,
  i: { userId: string; secretEnc: string; label: string },
): Promise<AdminCredential> {
  const { rows } = await db.query(
    `INSERT INTO admin_credentials (user_id, kind, totp_secret_enc, label)
     VALUES ($1, 'totp', $2, $3) RETURNING ${COLUMNS}`,
    [i.userId, i.secretEnc, i.label],
  );
  return toCredential(rows[0]!);
}

export async function insertPasskeyCredential(
  db: Queryable,
  i: { userId: string; credentialId: string; publicKey: Uint8Array; counter: number; transports: string[]; label: string },
): Promise<AdminCredential> {
  const { rows } = await db.query(
    `INSERT INTO admin_credentials (user_id, kind, credential_id, public_key, counter, transports, label)
     VALUES ($1, 'passkey', $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [i.userId, i.credentialId, Buffer.from(i.publicKey), i.counter, i.transports, i.label],
  );
  return toCredential(rows[0]!);
}
