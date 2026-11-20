"use client";

import type { ReactNode } from "react";
import { LoaderHold } from "@/components/dashboard/loader-hold";
import { LoaderStage, PageLoader } from "@/components/dashboard/page-loader";

export type FinancePage = "payouts" | "billing";

/** What each page is working out, in the order the page shows it. The last line stays. */
const LOADERS: Record<FinancePage, { label: string; lines: readonly string[] }> = {
  payouts: {
    label: "Payouts",
    lines: ["Checking your Stripe account", "Looking at your payouts", "Seeing what Stripe still needs"],
  },
  billing: {
    label: "Billing",
    lines: [
      "Gathering your invoices",
      "Working out the next invoice",
      "Checking your billing details",
      "Checking each property is ready",
    ],
  },
};

/** What loading.tsx shows for a Finance page: the logo loader alone in the empty content area. */
export function FinanceLoading({ page }: { page: FinancePage }) {
  const { label, lines } = LOADERS[page];
  return (
    <LoaderStage>
      <PageLoader label={label} lines={lines} track />
    </LoaderStage>
  );
}

/** The page content, held under the loader until it has been up for a full second. */
export function FinanceBody({ page, children }: { page: FinancePage; children: ReactNode }) {
  const { label, lines } = LOADERS[page];
  return (
    <LoaderHold page={`finance/${page}`} label={label} lines={lines}>
      {children}
    </LoaderHold>
  );
}
