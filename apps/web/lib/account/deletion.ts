import { APIError } from "better-auth";

type Run = (sql: string, values: unknown[]) => Promise<unknown[]>;

/**
 * Account deletion, as Better Auth's `beforeDelete` (wired in lib/auth.ts).
 *
 * What goes: the user row, and with it (FK cascades) sessions, sign-in
 * accounts, passkeys and guest_profile. What stays: booking records, for
 * seven years (privacy policy §4, Dutch tax law); they keep only the user id,
 * which no longer leads to a name or email. Messages stay with the host as
 * their record of the stay, unlinked from the guest.
 */

/** A paid stay whose checkout day hasn't passed. Cancelled and unpaid (pending) bookings don't count. */
export const UPCOMING_STAY_SQL = `
  SELECT id FROM bookings
  WHERE user_id = $1 AND status IN ('confirmed', 'checked_in') AND check_out_date >= $2::date
  LIMIT 1
`;

/** Throws while the guest has a stay to come: deleting would orphan a booking a host is still expecting. */
export async function assertCanDeleteAccount(userId: string, run: Run, today: string): Promise<void> {
  const rows = await run(UPCOMING_STAY_SQL, [userId, today]);
  if (rows.length > 0) {
    throw new APIError("CONFLICT", {
      code: "UPCOMING_STAY",
      message:
        "You have a stay that hasn't ended yet. You can delete your account after it ends, or once it's cancelled.",
    });
  }
}

/** Removes the links to the user from rows that outlive the account. */
export async function anonymizeGuestData(userId: string, run: Run): Promise<void> {
  // Proof of consent is kept as evidence, without the person (0017).
  await run(`UPDATE consent_log SET user_id = NULL WHERE user_id = $1`, [userId]);
  // The same anonymisation the retention sweep applies.
  await run(`UPDATE messages SET sender_id = NULL WHERE sender_id = $1 AND sender_role = 'guest'`, [userId]);
  await run(`UPDATE message_threads SET status = 'closed', updated_at = now() WHERE guest_id = $1`, [userId]);
}

/** The guest's calendar day. EU-only, so Amsterdam time stands in for every property. */
export function todayInEurope(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(now);
}
