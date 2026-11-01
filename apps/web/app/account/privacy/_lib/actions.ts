"use server";

import { query } from "@openbookings/db";
import { getServerSession } from "@/lib/auth";
import { assertCanDeleteAccount, todayInEurope } from "@/lib/account/deletion";

/**
 * Asked before the confirmation email goes out, so a guest with a stay to
 * come hears why now instead of after clicking the link. The same check runs
 * again when the link is opened (lib/auth.ts beforeDeleteUser).
 */
export async function checkCanDeleteAccount(): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await getServerSession();
  if (!session) return { ok: false, message: "Your session ended. Sign in again first." };
  try {
    await assertCanDeleteAccount(session.user.id, query, todayInEurope());
    return { ok: true };
  } catch (err) {
    const message = (err as { body?: { message?: string } }).body?.message;
    return { ok: false, message: message ?? "Could not check your bookings. Try again." };
  }
}
