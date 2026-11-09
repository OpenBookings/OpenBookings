import { headers } from "next/headers";
import { query } from "@openbookings/db";
import { auth } from "@/lib/auth";
import type { Details } from "@/app/account/personal-details/_lib/validate";

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
