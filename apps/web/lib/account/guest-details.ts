import { headers } from "next/headers";
import { query, queryOne } from "@openbookings/db";
import { auth } from "@/lib/auth";
import type { Address, Details } from "@/app/account/personal-details/_lib/validate";

/**
 * Writes a guest's personal details: phone and address to `guest_profile`
 * (which hosts read for their bookings), the first and last name through Better Auth, which
 * stays the one writer of the "user" row. Shared by the account page and checkout.
 * Throws when either write fails; callers turn that into copy.
 */
export async function saveGuestDetails(userId: string, details: Details): Promise<void> {
  const { phone, address: a } = details;
  await query(
    `INSERT INTO guest_profile (user_id, phone, address_line1, address_line2, postal_code, city, country)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       phone = EXCLUDED.phone,
       address_line1 = EXCLUDED.address_line1, address_line2 = EXCLUDED.address_line2,
       postal_code = EXCLUDED.postal_code, city = EXCLUDED.city, country = EXCLUDED.country,
       updated_at = now()`,
    [userId, phone, a?.line1 ?? null, a?.line2 ?? null, a?.postalCode ?? null, a?.city ?? null, a?.country ?? null],
  );
  // Names go through Better Auth only: the database derives `name` from them.
  // Compared with the stored names, not the session's: the session is cached
  // for minutes and would miss a save made just before.
  const current = await readGuestNames(userId);
  if (details.firstName !== current.firstName || details.lastName !== current.lastName) {
    await auth.api.updateUser({
      headers: await headers(),
      body: { firstName: details.firstName, lastName: details.lastName },
    });
  }
}

/**
 * The guest's first and last name as stored. Read from the database rather
 * than the session, whose cookie cache can serve names up to 5 minutes old.
 */
export async function readGuestNames(userId: string): Promise<{ firstName: string; lastName: string }> {
  const row = await queryOne<{ first_name: string; last_name: string }>(
    `SELECT first_name, last_name FROM "user" WHERE id = $1`,
    [userId],
  );
  return { firstName: row?.first_name ?? "", lastName: row?.last_name ?? "" };
}

type ProfileRow = {
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
};

/** A guest's saved phone and address. The address only when it is complete. */
export async function readGuestProfile(userId: string): Promise<{ phone: string | null; address: Address | null }> {
  const profile = await queryOne<ProfileRow>(
    `SELECT phone, address_line1, address_line2, postal_code, city, country FROM guest_profile WHERE user_id = $1`,
    [userId],
  );
  const address: Address | null =
    profile?.address_line1 && profile.postal_code && profile.city && profile.country
      ? {
          line1: profile.address_line1,
          line2: profile.address_line2,
          postalCode: profile.postal_code,
          city: profile.city,
          // char(2) pads with spaces; saves store upper case, but rows written by hand may not.
          country: profile.country.trim().toUpperCase(),
        }
      : null;
  return { phone: profile?.phone ?? null, address };
}
