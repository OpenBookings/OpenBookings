import { headers } from "next/headers";
import { query, queryOne } from "@openbookings/db";
import { auth } from "@/lib/auth";
import type { Address, Details } from "@/app/account/personal-details/_lib/validate";

/**
 * Writes a guest's personal details: phone and address to `guest_profile`
 * (which hosts read for their bookings), the name through Better Auth so the
 * session's cached user follows. Shared by the account page and checkout.
 * Throws when either write fails; callers turn that into copy.
 */
export async function saveGuestDetails(userId: string, currentName: string | null, details: Details): Promise<void> {
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
  if (details.name !== currentName) {
    await auth.api.updateUser({ headers: await headers(), body: { name: details.name } });
  }
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
