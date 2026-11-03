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
 * @returns how many properties were reassigned
 */
export async function reassignPropertiesFromFormerOwner(
  pool: { query: (text: string, values: unknown[]) => Promise<{ rowCount: number | null }> },
  input: { organizationId: string; userId: string },
): Promise<number> {
  const result = await pool.query(REASSIGN_OWNER_SQL, [input.organizationId, input.userId]);
  return result.rowCount ?? 0;
}

export const REASSIGN_OWNER_SQL = `
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
    )`;
