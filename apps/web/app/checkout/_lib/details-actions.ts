"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth";
import { saveGuestDetails } from "@/lib/account/guest-details";
import {
  parseCheckoutDetails,
  type CheckoutDetails,
  type DetailsField,
} from "@/app/account/personal-details/_lib/validate";

export type CheckoutSaveResult =
  | { ok: true; details: CheckoutDetails }
  | { ok: false; errors?: Partial<Record<DetailsField, string>>; message?: string };

const SIGNED_OUT = "Your session ended. Sign in again to save.";
const FAILED = "We couldn't save your details. Nothing has been charged — please try again.";

/**
 * Saves the checkout's details card to the guest's account before they pay,
 * so the host always has the phone and address of a paid booking. The page
 * calls `checkout.confirm` only after this returns ok, which is what makes
 * "nothing has been charged" true on every failure here.
 */
export async function saveCheckoutDetails(form: FormData): Promise<CheckoutSaveResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, message: SIGNED_OUT };
  const parsed = parseCheckoutDetails(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  try {
    await saveGuestDetails(session.user.id, session.user.name ?? null, parsed.value);
  } catch {
    return { ok: false, message: FAILED };
  }
  revalidatePath("/account", "layout");
  return { ok: true, details: parsed.value };
}
