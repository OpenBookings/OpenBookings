/**
 * Keeps `properties.owner_user_id` pointing at a current owner of the
 * property's organization.
 *
 * The column is stamped with the founding user at onboarding promotion and is
 * still read as "the host" by messaging and several dashboard queries. Nothing
 * updated it when that user was removed from the org or demoted by a co-owner,
 * so a former founder stayed attached to the properties. Authorization no
 * longer trusts the column (see PROPERTY_EDIT_ACCESS_SQL), but the other
 * readers do, so it is moved to a remaining owner rather than cleared:
 * clearing it would break message threads, which route to this user.
 *
 * Called after a member is removed or their role changes. Only touches
 * properties of THIS organization, and only when the user is no longer an
 * owner of it and another owner exists — if no owner remains the row is left
 * alone rather than nulled (the last-owner guard makes that unreachable, and a
 * stale value is harmless now that authz ignores it).
 *
 * @returns how many properties, and their message threads, were reassigned
 */
export async function reassignPropertiesFromFormerOwner(
  pool: { query: (text: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  input: { organizationId: string; userId: string },
): Promise<{ properties: number; threads: number }> {
  const result = await pool.query(REASSIGN_OWNER_SQL, [input.organizationId, input.userId]);
  const row = result.rows[0] ?? {};
  return { properties: Number(row.properties ?? 0), threads: Number(row.threads ?? 0) };
}

/**
 * One statement, so the property and its conversations change hands together
 * or not at all. Message threads carry their own copy of the host (host_id,
 * stamped at creation): left alone, the former founder would keep their guest
 * conversations and realtime pushes for properties they no longer have.
 */
export const REASSIGN_OWNER_SQL = `
  WITH moved AS (
    UPDATE properties p
    SET owner_user_id = (
      SELECT m."userId" FROM "member" m
      WHERE m."organizationId" = p.organization_id
        AND m.role = 'owner'
        AND m."userId" <> $2
      ORDER BY m."createdAt", m.id
      LIMIT 1
    )
    WHERE p.organization_id = $1
      AND p.owner_user_id = $2
      AND NOT EXISTS (
        SELECT 1 FROM "member" m
        WHERE m."organizationId" = p.organization_id
          AND m."userId" = $2
          AND m.role = 'owner'
      )
      AND EXISTS (
        SELECT 1 FROM "member" m
        WHERE m."organizationId" = p.organization_id
          AND m.role = 'owner'
          AND m."userId" <> $2
      )
    RETURNING p.id AS property_id, p.owner_user_id AS new_owner
  ),
  moved_threads AS (
    UPDATE message_threads t
    SET host_id = moved.new_owner
    FROM moved
    WHERE t.property_id = moved.property_id AND t.host_id = $2
    RETURNING t.id
  )
  SELECT (SELECT count(*) FROM moved)::int AS properties,
         (SELECT count(*) FROM moved_threads)::int AS threads`;
