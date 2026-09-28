import type { Metadata } from "next";
import {
  generateLegalMetadata,
  legalStaticParams,
  renderLegalPage,
} from "@/components/legal/LegalPage";

type Props = { params: Promise<{ locale: string; doc: string }> };

export function generateStaticParams() {
  return legalStaticParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return generateLegalMetadata(await params);
}

export default async function LegalDocumentPage({ params }: Props) {
  return renderLegalPage(await params);
}
