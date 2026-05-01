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
  partnerAgreement?: { signedAt: string; signerIp: string; downloadedAt?: string; downloadedFilename?: string };
  dpa?: { signedAt: string; signerIp: string; downloadedAt?: string; downloadedFilename?: string };
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

/** Record that the signed PDF was downloaded, including the filename used. */
export async function trackLegalDocumentDownload(
  docId: "partner-agreement" | "dpa",
  filename: string
): Promise<void> {
  await getSession();

  const stepData = await loadStepData();
  const legal = stepData["legal-n-boring"];
  if (!legal) return;

  const key = docId === "partner-agreement" ? "partnerAgreement" : "dpa";
  const existing = legal[key];
  if (!existing) return;

  const updated: LegalNBoringData = {
    ...legal,
    [key]: { ...existing, downloadedAt: new Date().toISOString(), downloadedFilename: filename },
  };

  await saveStepData("legal-n-boring", updated);
}

const DOC_LABELS: Record<"partner-agreement" | "dpa", string> = {                              
    "partner-agreement": "PartnerAgreement",                                             
    dpa: "DPA",                                                            
  };   

function buildFilename(legalCompanyName: string, docId: "partner-agreement" | "dpa"): string {
  const now = new Date();
  const currentTime = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  const company = legalCompanyName
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "");
  return `${company}_${DOC_LABELS[docId]}_${currentTime}.pdf`;
}

/** Generate and return a filled PDF for a signed legal document. */
export async function downloadLegalDocument(
  docId: "partner-agreement" | "dpa"
): Promise<{ bytes: Uint8Array; filename: string }> {
  await getSession();

  const stepData = await loadStepData();
  const legal = stepData["legal-n-boring"];
  if (!legal) throw new Error("No legal data found");

  const signature = docId === "partner-agreement" ? legal.partnerAgreement : legal.dpa;
  if (!signature) throw new Error(`Document ${docId} has not been signed`);

  const bytes = await handleExport(docId, {
    legalCompanyName: legal.legalCompanyName,
    fullName: legal.fullName,
    roleTitle: legal.roleTitle,
    signedAt: signature.signedAt,
  });

  return { bytes, filename: buildFilename(legal.legalCompanyName, docId) };
}
