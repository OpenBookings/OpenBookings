import type { Queryable } from "@openbookings/db";

/**
 * Who hears about a booking at a property: its organisation's owners. In
 * testing mode a demo hotel has no real owner, so the mail goes to the
 * signed-in guest's own address and the whole flow can be followed in one inbox.
 */
export async function hostRecipients(
  db: Queryable,
  i: { propertyId: string; guestEmail: string; testing: boolean },
): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT p.is_demo, u.email
       FROM properties p
       LEFT JOIN "member" m ON m."organizationId" = p.organization_id AND m.role = 'owner'
       LEFT JOIN "user" u ON u.id = m."userId"
      WHERE p.id = $1::uuid
      ORDER BY u.email`,
    [i.propertyId],
  );
  const found = rows as { is_demo: boolean; email: string | null }[];
  if (found.length === 0) return [];
  if (i.testing && found[0]!.is_demo) return [i.guestEmail];
  return [...new Set(found.map((r) => r.email).filter((e): e is string => !!e))];
}
