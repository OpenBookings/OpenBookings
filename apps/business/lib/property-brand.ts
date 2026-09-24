import { cache } from "react";
import { getHostScopedDb, type SessionLike } from "@openbookings/authz";

/**
 * The identity the dashboard chrome wears: whose property this is, and the
 * logo to show for it.
 *
 * `logoUrl` is nullable and the two cases are different states, not one:
 * a host with no uploaded logo gets the plain OpenBookings header, while a
 * host who has uploaded one gets the co-branded header. Callers must not
 * collapse the two by substituting a placeholder.
 */
export type PropertyBrand = {
  name: string;
  logoUrl: string | null;
};

/** The shape the query below returns — snake_case, straight from Postgres. */
export type PropertyBrandRow = {
  name: string;
  logo_url: string | null;
};

/**
 * Row -> brand, kept separate from the query so the edge cases are testable
 * without a database.
 *
 * A blank name or a blank URL is treated as absent rather than passed
 * through: `<img src="">` re-requests the current page in every browser, and
 * a header whose only text is whitespace is worse than the default one.
 */
export function toPropertyBrand(row: PropertyBrandRow | null): PropertyBrand | null {
  if (!row) return null;
  const name = row.name?.trim();
  if (!name) return null;
  const logoUrl = row.logo_url?.trim();
  return { name, logoUrl: logoUrl || null };
}

/**
 * The host's property and its logo, for the sidebar header.
 *
 * One property per host today, so this takes the first by name the same way
 * loadEditorData does — deliberately the same ordering, so the header can
 * never name a different property than the editor opens. A property switcher
 * would replace both call sites together.
 *
 * Wrapped in React's request cache: the dashboard layout is the only caller
 * now, but a second one must not mean a second round-trip.
 */
export const loadPropertyBrand = cache(
  async (session: SessionLike | null | undefined): Promise<PropertyBrand | null> => {
    if (!session) return null;

    const host = getHostScopedDb(session);
    const row = await host.queryOne<PropertyBrandRow>(
      `SELECT p.name, i.url AS logo_url
         FROM properties p
         LEFT JOIN property_images i
           ON i.property_id = p.id AND i."group" = 'logo'
        WHERE p.owner_user_id = $1
        ORDER BY p.name
        LIMIT 1`,
    );

    return toPropertyBrand(row);
  },
);
