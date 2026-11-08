import type { VatTreatment } from "../vat";
import type { ReconcileResult } from "./reconcile";

/** Why a host's invoice could not be drafted. */
export type Blocker = {
  entityId: string;
  reasons: ("missing_fields" | "mixed_vat_treatment" | "vies_invalid" | "vies_unavailable" | "non_eu")[];
  /** The billing profile fields still missing, when `missing_fields` is a reason. */
  missing?: string[];
};

/** One draft the draft step created. */
export type DraftSummary = {
  entityId: string;
  invoiceId: string;
  docType: "invoice" | "credit_note";
  vatTreatment: VatTreatment;
  grossTotal: bigint;
  netTotal: bigint;
  vatTotal: bigint;
  vatRoundingDiff: bigint;
  feeCount: number;
  refundCount: number;
};

/** What a draft run reports, and what the emailed run report is written from. */
export type DraftReport = {
  /** `YYYY-MM` */
  period: string;
  dryRun: boolean;
  reconcile: ReconcileResult;
  drafts: DraftSummary[];
  blocked: Blocker[];
  /** Entities whose invoice for the period was already issued, so left alone. */
  skippedIssued: string[];
};
