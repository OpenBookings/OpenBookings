"use server";

import { headers } from "next/headers";
import { withWriteTransaction, writePool } from "../db";
import { requireStaff } from "../staff";
import { relyingParty } from "./enrol";
import * as stepUp from "./step-up";
import type { StepUpChallenge, StepUpDeps, StepUpProof, StepUpResult } from "./step-up";

/**
 * The browser's half of a step-up (the confirm dialog): begin one for an
 * action and target, then answer it once with a passkey or a code. A wrong
 * answer spends it; begin again to retry. Refusals (too many wrong answers,
 * nothing enrolled, a missing setting) come back with a message to show. The
 * action itself spends the token it gets back (consumeStepUp in ./step-up.ts).
 */

const deps = (): StepUpDeps => ({
  db: { query: (text, values) => writePool().query(text, values), transaction: (fn) => withWriteTransaction(fn) },
  totpKey: process.env.ADMIN_TOTP_KEY ?? "",
  rp: async () => relyingParty(process.env, (await headers()).get("host")),
  now: () => new Date(),
});

export async function beginStepUp(action: string, targetId: string): Promise<StepUpChallenge> {
  const staff = await requireStaff();
  return stepUp.beginStepUp(deps(), staff, action, targetId);
}

export async function completeStepUp(id: string, proof: StepUpProof): Promise<StepUpResult> {
  const staff = await requireStaff();
  return stepUp.completeStepUp(deps(), staff, id, proof);
}
