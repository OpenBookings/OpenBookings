import { DEMO_ORG_ID } from "@openbookings/mode";

type Pool = { query: (text: string, values: unknown[]) => Promise<{ rows: { email: string }[] }> };

/**
 * Who hears about a new-device sign-in: the owners of the organisations the
 * user belongs to. The demo organisation is left out in every mode: in testing
 * mode every host owns it, so counting it would mail each host's address, IP
 * and browser to every other host.
 */
export const ALERT_OWNERS_SQL = `SELECT DISTINCT u.email
       FROM "member" me
       JOIN "member" mo ON mo."organizationId" = me."organizationId" AND mo.role = 'owner'
       JOIN "user" u ON u.id = mo."userId"
       WHERE me."userId" = $1 AND me."organizationId" <> $2`;

export async function alertOwnerEmails(pool: Pool, userId: string): Promise<string[]> {
  const { rows } = await pool.query(ALERT_OWNERS_SQL, [userId, DEMO_ORG_ID]);
  return rows.map((row) => row.email);
}
