"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { query } from "@openbookings/db";
import { auth, getServerSession } from "@/lib/auth";
import { parseDetails } from "./validate";

export type SaveState = {
  status: "idle" | "saved" | "error";
  errors?: Record<string, string | undefined>;
  message?: string;
};

const SIGNED_OUT: SaveState = { status: "error", message: "Your session ended. Sign in again to save." };
const FAILED: SaveState = { status: "error", message: "Could not save. Check your connection and try again." };

/** Saves the whole Personal details form. Nothing is written unless all of it is valid. */
export async function saveDetails(_prev: SaveState, form: FormData): Promise<SaveState> {
  const session = await getServerSession();
  if (!session) return SIGNED_OUT;
  const parsed = parseDetails(form);
  if (!parsed.ok) return { status: "error", errors: parsed.errors };
  const { name, phone, address: a } = parsed.value;
  try {
    await query(
      `INSERT INTO guest_profile (user_id, phone, address_line1, address_line2, postal_code, city, country)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         phone = EXCLUDED.phone,
         address_line1 = EXCLUDED.address_line1, address_line2 = EXCLUDED.address_line2,
         postal_code = EXCLUDED.postal_code, city = EXCLUDED.city, country = EXCLUDED.country,
         updated_at = now()`,
      [session.user.id, phone, a?.line1 ?? null, a?.line2 ?? null, a?.postalCode ?? null, a?.city ?? null, a?.country ?? null],
    );
    if (name !== session.user.name) {
      // Through Better Auth, so the session cookie's cached user is updated too.
      await auth.api.updateUser({ headers: await headers(), body: { name } });
    }
  } catch {
    return FAILED;
  }
  revalidatePath("/account", "layout");
  return { status: "saved" };
}
