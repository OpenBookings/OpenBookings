"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@openbookings/db";
import { resolvePaymentFlag, type ResolveResult } from "./flagged-payments";
import { requireSuperAdmin } from "./super-admin";

export async function adminResolvePaymentFlag(i: { flagId: string; note?: string }): Promise<ResolveResult> {
  requireSuperAdmin();
  const result = await resolvePaymentFlag(getPool(), i);
  revalidatePath("/flagged-payments");
  return result;
}
