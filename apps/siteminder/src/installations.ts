import type { InstallationRegistration } from "@openbookings/apps-contract";
import type { Queryable } from "./db/migrate";

export type AppInstallation = {
  id: string;
  propertyCode: string;
  propertyName: string;
  /** The per-installation Apps API key, stored as given (see report on encryption at rest). */
  apiKey: string;
  coreBaseUrl: string;
  status: "active" | "removed";
  feedCursor: string | null;
};

type Row = {
  id: string;
  property_code: string;
  property_name: string;
  api_key: string;
  core_base_url: string;
  status: "active" | "removed";
  feed_cursor: string | null;
};

const COLUMNS = `id, property_code, property_name, api_key, core_base_url, status, feed_cursor`;

function fromRow(r: Row): AppInstallation {
  return {
    id: r.id,
    propertyCode: r.property_code,
    propertyName: r.property_name,
    apiKey: r.api_key,
    coreBaseUrl: r.core_base_url,
    status: r.status,
    feedCursor: r.feed_cursor,
  };
}

/** Register or re-register an installation. A re-registration refreshes the details, reactivates it and keeps `feed_cursor`. */
export async function upsertInstallation(db: Queryable, r: InstallationRegistration): Promise<void> {
  await db.query(
    `INSERT INTO siteminder.installations (id, property_code, property_name, api_key, core_base_url, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     ON CONFLICT (id) DO UPDATE SET
       property_code = EXCLUDED.property_code,
       property_name = EXCLUDED.property_name,
       api_key = EXCLUDED.api_key,
       core_base_url = EXCLUDED.core_base_url,
       status = 'active'`,
    [r.installationId, r.propertyCode, r.propertyName, r.apiKey, r.coreBaseUrl],
  );
}

/** Mark removed. Idempotent; unknown ids are a no-op. */
export async function removeInstallation(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE siteminder.installations SET status = 'removed' WHERE id = $1`, [id]);
}

/** The active installation for a SiteMinder hotel code, or null. */
export async function installationByHotelCode(db: Queryable, code: string): Promise<AppInstallation | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS} FROM siteminder.installations WHERE property_code = $1 AND status = 'active'`,
    [code],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function activeInstallations(db: Queryable): Promise<AppInstallation[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS} FROM siteminder.installations WHERE status = 'active' ORDER BY created_at, id`,
  );
  return rows.map(fromRow);
}
