"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth";
import { saveGuestDetails } from "@/lib/account/guest-details";
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
  try {
    await saveGuestDetails(session.user.id, session.user.name ?? null, parsed.value);
  } catch {
    return FAILED;
  }
  revalidatePath("/account", "layout");
  return { status: "saved" };
}
