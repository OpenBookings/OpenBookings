import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/LegalDocument";
import {
  DEFAULT_LEGAL_LOCALE,
  getCurrentVersion,
  getDocument,
  getVersion,
  isLegalLocale,
  LEGAL_DOCUMENTS,
  LEGAL_LOCALES,
  resolveLocaleEntry,
  type LegalLocale,
} from "@/lib/legal/documents";

type Params = { locale: string; doc: string; version?: string };

/**
 * Resolves a request to a concrete (document, version, locale) triple, or
 * `undefined` when any part is unknown. Kept separate from rendering so both
 * the page and its metadata resolve identically.
 */
async function resolve({ locale, doc: slug, version }: Params) {
  if (!isLegalLocale(locale)) return undefined;

  const doc = getDocument(slug);
  if (!doc) return undefined;

  const resolvedVersion = version ? getVersion(doc, version) : getCurrentVersion(doc);
  if (!resolvedVersion) return undefined;

  const resolved = resolveLocaleEntry(resolvedVersion, locale, doc.fallbackLocale);
  if (!resolved) return undefined;

  const loaded = await resolved.entry.load();

  return {
    doc,
    version: resolvedVersion,
    locale: resolved.renderedLocale,
    requestedLocale: locale as LegalLocale,
    status: resolved.entry.status,
    title: loaded.title,
    Body: loaded.default,
    isArchived: resolvedVersion.version !== doc.currentVersion,
  };
}

export async function generateLegalMetadata(params: Params): Promise<Metadata> {
  const resolved = await resolve(params);
  if (!resolved) return {};

  const { doc, title, status, isArchived, locale } = resolved;

  // A superseded version and an unreviewed translation must not compete with
  // the authoritative text in search results.
  const shouldIndex = !isArchived && status === "translated";

  return {
    title: `${title} | OpenBookings`,
    alternates: {
      canonical: `/legal/${doc.fallbackLocale}/${doc.slug}`,
      languages: Object.fromEntries(
        (Object.keys(resolved.version.locales) as LegalLocale[]).map((code) => [
          code,
          `/legal/${code}/${doc.slug}`,
        ])
      ),
    },
    robots: shouldIndex ? undefined : { index: false, follow: true },
    other: {
      // Lets a consent record name exactly what was rendered.
      "ob:document-version": `${doc.slug}@${resolved.version.version}/${locale}`,
    },
  };
}

export async function renderLegalPage(params: Params) {
  const resolved = await resolve(params);
  if (!resolved) notFound();

  const { doc, version, locale, status, title, Body, isArchived } = resolved;

  return (
    <LegalDocument
      doc={doc}
      version={version}
      locale={locale}
      status={status}
      title={title}
      isArchived={isArchived}
    >
      <Body />
    </LegalDocument>
  );
}

/** Every locale of every document's current version. */
export function legalStaticParams(): Array<{ locale: string; doc: string }> {
  return LEGAL_DOCUMENTS.flatMap((doc) =>
    LEGAL_LOCALES.map((locale) => ({ locale, doc: doc.slug }))
  );
}

/** Every locale of every registered version, including superseded ones. */
export function legalVersionStaticParams(): Array<{
  locale: string;
  doc: string;
  version: string;
}> {
  return LEGAL_DOCUMENTS.flatMap((doc) =>
    doc.versions.flatMap((version) =>
      LEGAL_LOCALES.map((locale) => ({
        locale,
        doc: doc.slug,
        version: version.version,
      }))
    )
  );
}

export { DEFAULT_LEGAL_LOCALE };
