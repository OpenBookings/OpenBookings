"use server";

import { revalidatePath } from "next/cache";
import { writePool } from "./db";
import { resolvePaymentFlagFromForm, type ResolveInput, type ResolveResult } from "./flagged-payments";
import { requireStaff } from "./staff";

/** Resolves a flag, with the host's room price / tourist tax split when staff typed one. */
export async function adminResolvePaymentFlag(i: ResolveInput): Promise<ResolveResult> {
  await requireStaff();
  const result = await resolvePaymentFlagFromForm(writePool(), i);
  revalidatePath("/flagged-payments");
  return result;
}
