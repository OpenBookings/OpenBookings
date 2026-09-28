import type { Metadata } from "next";
import {
  generateLegalMetadata,
  legalVersionStaticParams,
  renderLegalPage,
} from "@/components/legal/LegalPage";

type Props = { params: Promise<{ locale: string; doc: string; version: string }> };

export function generateStaticParams() {
  return legalVersionStaticParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return generateLegalMetadata(await params);
}

/**
 * Pinned-version route. A superseded policy stays readable here because it is
 * the text that governs anything agreed while it was in force.
 */
export default async function LegalDocumentVersionPage({ params }: Props) {
  return renderLegalPage(await params);
}
