"use server";

import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { writePool } from "../db";
import { requireStaff } from "../staff";
import {
  completePasskeyEnrolment,
  completeTotpEnrolment,
  EnrolRefused,
  relyingParty,
  startPasskeyEnrolment,
  startTotpEnrolment,
  stepUpNotAvailable,
  type EnrolDeps,
  type EnrolProof,
} from "./enrol";

/**
 * Enrolling step-up credentials from /security. Refusals come back as a
 * message (a thrown error's text is hidden from the browser in production).
 */
export type EnrolResult<T> = { ok: true; value: T } | { ok: false; error: string };

const deps = (): EnrolDeps => ({
  db: writePool(),
  bootstrapCode: process.env.ADMIN_BOOTSTRAP_CODE,
  totpKey: process.env.ADMIN_TOTP_KEY ?? "",
  // Task 4 wires the real step-up (consumeStepUp for "security.enrol").
  requireStepUp: stepUpNotAvailable,
  now: () => new Date(),
});

async function attempt<T>(fn: () => Promise<T>): Promise<EnrolResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof EnrolRefused) return { ok: false, error: error.message };
    throw error;
  }
}

/** The browser sends it: keep only string fields. */
function proofFrom(input: unknown): EnrolProof {
  const p = (input ?? {}) as Record<string, unknown>;
  return {
    bootstrap: typeof p.bootstrap === "string" ? p.bootstrap : undefined,
    stepUpToken: typeof p.stepUpToken === "string" ? p.stepUpToken : undefined,
  };
}

const rp = async () => relyingParty(process.env, (await headers()).get("host"));

export async function beginPasskeyEnrolment(
  proof: EnrolProof,
): Promise<EnrolResult<PublicKeyCredentialCreationOptionsJSON>> {
  const staff = await requireStaff();
  return attempt(async () => startPasskeyEnrolment(deps(), staff, proofFrom(proof), await rp()));
}

export async function finishPasskeyEnrolment(response: RegistrationResponseJSON): Promise<EnrolResult<null>> {
  const staff = await requireStaff();
  const result = await attempt(async () => {
    await completePasskeyEnrolment(deps(), staff, response, await rp());
    return null;
  });
  revalidatePath("/security");
  return result;
}

export async function beginTotpEnrolment(
  proof: EnrolProof,
): Promise<EnrolResult<{ uri: string; secretPreview: string }>> {
  const staff = await requireStaff();
  return attempt(() => startTotpEnrolment(deps(), staff, proofFrom(proof)));
}

export async function finishTotpEnrolment(code: string): Promise<EnrolResult<null>> {
  const staff = await requireStaff();
  const result = await attempt(async () => {
    await completeTotpEnrolment(deps(), staff, String(code));
    return null;
  });
  revalidatePath("/security");
  return result;
}
