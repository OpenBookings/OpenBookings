"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { query } from "@openbookings/db";
import { auth, getServerSession } from "@/lib/auth";
import { parseAddress, parseName, parsePhone } from "./validate";

export type SaveState = {
  status: "idle" | "saved" | "error";
  errors?: Record<string, string | undefined>;
  message?: string;
};

const SIGNED_OUT: SaveState = { status: "error", message: "Your session ended. Sign in again to save." };
const FAILED: SaveState = { status: "error", message: "Could not save. Check your connection and try again." };

export async function saveName(_prev: SaveState, form: FormData): Promise<SaveState> {
  const session = await getServerSession();
  if (!session) return SIGNED_OUT;
  const parsed = parseName(form);
  if (!parsed.ok) return { status: "error", errors: parsed.errors };
  try {
    // Through Better Auth, so the session cookie's cached user is updated too.
    await auth.api.updateUser({ headers: await headers(), body: { name: parsed.value } });
  } catch {
    return FAILED;
  }
  revalidatePath("/account", "layout");
  return { status: "saved" };
}

export async function savePhone(_prev: SaveState, form: FormData): Promise<SaveState> {
  const session = await getServerSession();
  if (!session) return SIGNED_OUT;
  const parsed = parsePhone(form);
  if (!parsed.ok) return { status: "error", errors: parsed.errors };
  try {
    await query(
      `INSERT INTO guest_profile (user_id, phone) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, updated_at = now()`,
      [session.user.id, parsed.value],
    );
  } catch {
    return FAILED;
  }
  revalidatePath("/account/personal-details");
  return { status: "saved" };
}

export async function saveAddress(_prev: SaveState, form: FormData): Promise<SaveState> {
  const session = await getServerSession();
  if (!session) return SIGNED_OUT;
  const parsed = parseAddress(form);
  if (!parsed.ok) return { status: "error", errors: parsed.errors };
  const a = parsed.value;
  try {
    await query(
      `INSERT INTO guest_profile (user_id, address_line1, address_line2, postal_code, city, country)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         address_line1 = EXCLUDED.address_line1, address_line2 = EXCLUDED.address_line2,
         postal_code = EXCLUDED.postal_code, city = EXCLUDED.city, country = EXCLUDED.country,
         updated_at = now()`,
      [session.user.id, a?.line1 ?? null, a?.line2 ?? null, a?.postalCode ?? null, a?.city ?? null, a?.country ?? null],
    );
  } catch {
    return FAILED;
  }
  revalidatePath("/account/personal-details");
  return { status: "saved" };
}
