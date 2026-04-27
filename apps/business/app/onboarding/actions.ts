"use server";

import { auth } from "@/lib/auth";
import { query, queryOne } from "@openbookings/db";
import { headers } from "next/headers";
import type { HostStep } from "./steps";
import { handleExport } from "@/lib/pdf-generator/form-fill";

export interface LegalNBoringData {
  legalCompanyName: string;
  fullName: string;
  roleTitle: string;
  partnerAgreement?: { signedAt: string; signerIp: string };
  dpa?: { signedAt: string; signerIp: string };
}

export interface CoreInfoData {
  displayName: string;
  description: string;
  streetAddress: string;
  city: string;
  country: string;
  postalCode: string;
  coordinates: [number, number] | null;
  houseRulesText: string;
}

type StepData = {
  "core-info"?: CoreInfoData;
  "legal-n-boring"?: LegalNBoringData;
  [key: string]: unknown;
};

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthenticated");
  return session;
}

/** Persist step data and mark the step complete. */
export async function saveStepData(step: HostStep, data: unknown): Promise<void> {
  const session = await getSession();
  const userId = session.user.id;

  await query(
    `INSERT INTO host_onboarding (user_id, completed_steps, step_data)
     VALUES ($1, ARRAY[$2::text], $3::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET
       completed_steps = (
         SELECT array_agg(DISTINCT elem ORDER BY elem)
         FROM unnest(
           array_append(host_onboarding.completed_steps, $2::text)
         ) AS elem
       ),
       step_data = host_onboarding.step_data || $3::jsonb`,
    [userId, step, JSON.stringify({ [step]: data })]
  );
}

/** Load all previously saved step data for the current user. */
export async function loadStepData(): Promise<StepData> {
  const session = await getSession();

  const row = await queryOne<{ step_data: StepData }>(
    `SELECT step_data FROM host_onboarding WHERE user_id = $1`,
    [session.user.id]
  );

  return row?.step_data ?? {};
}

/** Record a legal document signature. Captures the signer's IP server-side. */
export async function signLegalDocument(
  docId: "partner-agreement" | "dpa",
  signerDetails: { legalCompanyName: string; fullName: string; roleTitle: string }
): Promise<void> {
  await getSession();
  const hdrs = await headers();

  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    "unknown";

  const existing = await loadStepData();
  const legal = existing["legal-n-boring"] ?? ({} as LegalNBoringData);

  const signature = { signedAt: new Date().toISOString(), signerIp: ip };
  const updated: LegalNBoringData = {
    ...legal,
    ...signerDetails,
    ...(docId === "partner-agreement"
      ? { partnerAgreement: signature }
      : { dpa: signature }),
  };

  await saveStepData("legal-n-boring", updated);
}

/** Generate and return a filled PDF for a signed legal document. */
export async function downloadLegalDocument(
  docId: "partner-agreement" | "dpa"
): Promise<Uint8Array> {
  await getSession();
  return handleExport(docId, "v1");
}
