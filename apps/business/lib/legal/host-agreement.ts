import type { ComponentType } from "react";
import type { MDXProps } from "mdx/types";
import { HOST_AGREEMENT_VERSION } from "@openbookings/authz/host-agreement";

export type HostAgreementVersion = {
  /** Also the archive URL segment: /legal/host-agreement/v/<version>. */
  version: string;
  /** ISO dates (YYYY-MM-DD). */
  effectiveFrom: string;
  lastUpdated: string;
  load: () => Promise<{ default: ComponentType<MDXProps>; title: string }>;
};

/**
 * Every published version of the Host Agreement, newest first. English only:
 * the agreement says the English text is the sole authoritative version.
 *
 * A version stays here after it is superseded, so a host can always read the
 * exact text it accepted (the acceptance record links to its version's page).
 * v1.2 (the "Partner Agreement") was never published here and is not listed.
 */
export const HOST_AGREEMENT_VERSIONS: readonly HostAgreementVersion[] = [
  {
    version: "1.5",
    effectiveFrom: "2026-11-27",
    lastUpdated: "2026-11-27",
    load: () => import("@/content/legal/host-agreement/1.5/en.mdx"),
  },
  {
    version: "1.4",
    effectiveFrom: "2026-11-20",
    lastUpdated: "2026-11-20",
    load: () => import("@/content/legal/host-agreement/1.4/en.mdx"),
  },
  {
    version: "1.3",
    effectiveFrom: "2026-11-18",
    lastUpdated: "2026-11-18",
    load: () => import("@/content/legal/host-agreement/1.3/en.mdx"),
  },
];

export function getHostAgreementVersion(version: string): HostAgreementVersion | undefined {
  return HOST_AGREEMENT_VERSIONS.find((v) => v.version === version);
}

/** The version hosts accept now. Its text must be registered above. */
export function currentHostAgreement(): HostAgreementVersion {
  const current = getHostAgreementVersion(HOST_AGREEMENT_VERSION);
  if (!current) {
    throw new Error(`Host Agreement ${HOST_AGREEMENT_VERSION} has no registered text`);
  }
  return current;
}
