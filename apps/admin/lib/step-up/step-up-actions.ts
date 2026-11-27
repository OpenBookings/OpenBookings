"use server";

import { headers } from "next/headers";
import { isDangerousAction } from "../dangerous-actions";
import { AdminReadOnlyError, withWriteTransaction, writePool } from "../db";
import { requireStaff } from "../staff";
import { relyingParty } from "./enrol";
import * as stepUp from "./step-up";
import type { StepUpChallenge, StepUpDeps, StepUpProof, StepUpResult } from "./step-up";

/**
 * The browser's half of a step-up (the confirm dialog): begin one for an
 * action and target, then answer it once with a passkey or a code. A wrong
 * answer spends it; begin again to retry. Refusals (too many wrong answers,
 * nothing enrolled, a missing setting, a read-only console) come back with a
 * message to show. The action itself spends the token it gets back
 * (consumeStepUp in ./step-up.ts). Only the dangerous actions
 * (../dangerous-actions.ts) can be confirmed.
 */

const deps = (): StepUpDeps => ({
  db: { query: (text, values) => writePool().query(text, values), transaction: (fn) => withWriteTransaction(fn) },
  totpKey: process.env.ADMIN_TOTP_KEY ?? "",
  rp: async () => relyingParty(process.env, (await headers()).get("host")),
  now: () => new Date(),
});

/** No write connection: nothing can be confirmed (or done) here. */
async function writable<T>(fn: () => Promise<T>): Promise<T | stepUp.StepUpRefusal<"config">> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AdminReadOnlyError) return { ok: false, reason: "config", message: error.message };
    throw error;
  }
}

export async function beginStepUp(action: string, targetId: string): Promise<StepUpChallenge> {
  const staff = await requireStaff();
  if (!isDangerousAction(action)) throw new stepUp.StepUpError("Not an action that can be confirmed");
  return writable(() => stepUp.beginStepUp(deps(), staff, action, targetId));
}

export async function completeStepUp(id: string, proof: StepUpProof): Promise<StepUpResult> {
  const staff = await requireStaff();
  return writable(() => stepUp.completeStepUp(deps(), staff, id, proof));
}
