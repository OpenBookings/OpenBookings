"use server";

import { revalidatePath } from "next/cache";
import { dangerousAction } from "./dangerous";
import type { Confirmation, DangerousResult } from "./dangerous-actions";
import { writePool } from "./db";
import { resolvePaymentFlagFromForm, type ResolveInput, type ResolveResult } from "./flagged-payments";
import { UUID_RE } from "./search";
import { requireStaff } from "./staff";

/**
 * Resolves a flag, with the host's room price / tourist tax split when staff
 * typed one. Dangerous (./dangerous.ts): it records how the money splits, so
 * it takes the confirm dialog's reason and step-up token, for the flag.
 */
export async function adminResolvePaymentFlag(
  i: ResolveInput,
  confirm: Confirmation,
): Promise<DangerousResult<ResolveResult>> {
  await requireStaff();
  if (typeof i?.flagId !== "string" || !UUID_RE.test(i.flagId)) return { ok: true, value: { ok: false, error: "invalid" } };
  return dangerousAction(
    {
      action: "payment_flag.resolve",
      targetType: "payment_flag",
      targetId: i.flagId,
      reason: confirm?.reason,
      stepUpToken: confirm?.stepUpToken,
      detail: { note: i.note ?? null, room_price: i.roomPrice ?? null, tourist_tax: i.touristTax ?? null },
    },
    async () => {
      const result = await resolvePaymentFlagFromForm(writePool(), i);
      revalidatePath("/flagged-payments");
      return result;
    },
  );
}
