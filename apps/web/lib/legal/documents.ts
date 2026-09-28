import type { ComponentType } from "react";

/**
 * Registry of legal documents.
 *
 * Legal text is addressed as `<slug>@<version>/<locale>` rather than as a
 * single mutable page. Two things depend on that:
 *
 *  1. Evidence. To show a user consented we have to be able to say *which*
 *     wording, in *which* language, they were shown. A version identifier is
 *     what a `consent_log` row stores; `documentVersionId()` produces it.
 *  2. Archival. A superseded policy has to stay readable at a stable URL,
 *     because "the terms in force on the day of the booking" is the text that
 *     governs that booking — not whatever is current now.
 *
 * Loaders are declared as literal dynamic imports so the bundler can resolve
 * them statically; a templated `import(\`...\${locale}\`)` would not survive
 * tree-shaking and would fail silently for a missing locale.
 */

export const LEGAL_LOCALES = ["en", "nl", "fr"] as const;
export type LegalLocale = (typeof LEGAL_LOCALES)[number];

export const DEFAULT_LEGAL_LOCALE: LegalLocale = "en";

export const LEGAL_LOCALE_LABELS: Record<LegalLocale, string> = {
  en: "English",
  nl: "Nederlands",
  fr: "Français",
};

/**
 * `draft` means the file exists but has not been through translation review.
 * Draft locales are served (so a translator can preview them in context) but
 * are marked `noindex` and carry a banner, because a half-translated policy is
 * more dangerous than an English one.
 */
export type TranslationStatus = "translated" | "draft";

type LoadedDocument = {
  default: ComponentType;
  title: string;
};

type LocaleEntry = {
  status: TranslationStatus;
  load: () => Promise<LoadedDocument>;
};

export type LegalVersion = {
  /** Stable identifier; also the archive URL segment. */
  version: string;
  /** Date this wording took legal effect. */
  effectiveFrom: string;
  /** Date this wording was last edited. */
  lastUpdated: string;
  locales: Partial<Record<LegalLocale, LocaleEntry>>;
};

export type LegalDocument = {
  slug: string;
  /** Falls back to this when a document has no entry for the requested locale. */
  fallbackLocale: LegalLocale;
  currentVersion: string;
  versions: LegalVersion[];
};

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    slug: "privacy",
    fallbackLocale: "en",
    currentVersion: "2026-09-21",
    versions: [
      {
        version: "2026-09-21",
        effectiveFrom: "2026-08-01",
        lastUpdated: "2026-09-21",
        locales: {
          en: {
            status: "translated",
            load: () => import("@/content/legal/privacy/2026-09-21/en.mdx"),
          },
          nl: {
            status: "draft",
            load: () => import("@/content/legal/privacy/2026-09-21/nl.mdx"),
          },
          fr: {
            status: "draft",
            load: () => import("@/content/legal/privacy/2026-09-21/fr.mdx"),
          },
        },
      },
    ],
  },
];

export function getDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);
}

export function getVersion(doc: LegalDocument, version: string): LegalVersion | undefined {
  return doc.versions.find((v) => v.version === version);
}

export function getCurrentVersion(doc: LegalDocument): LegalVersion {
  const current = getVersion(doc, doc.currentVersion);
  if (!current) {
    // A registry that points at a version it does not contain is a build-time
    // mistake, not a runtime condition to render around.
    throw new Error(
      `Legal document "${doc.slug}" names current version "${doc.currentVersion}", which is not registered.`
    );
  }
  return current;
}

export function isLegalLocale(value: string): value is LegalLocale {
  return (LEGAL_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolves the entry to render, falling back to the document's fallback locale
 * when the requested language has no file at that version. The returned
 * `renderedLocale` is what was actually shown — that, not the requested
 * locale, is what belongs in a consent record.
 */
export function resolveLocaleEntry(
  version: LegalVersion,
  requested: LegalLocale,
  fallback: LegalLocale
): { entry: LocaleEntry; renderedLocale: LegalLocale } | undefined {
  const direct = version.locales[requested];
  if (direct) return { entry: direct, renderedLocale: requested };

  const fallbackEntry = version.locales[fallback];
  if (fallbackEntry) return { entry: fallbackEntry, renderedLocale: fallback };

  return undefined;
}

/**
 * The identifier to persist alongside a consent decision, e.g.
 * `privacy@2026-09-21/nl`.
 */
export function documentVersionId(
  slug: string,
  version: string,
  locale: LegalLocale
): string {
  return `${slug}@${version}/${locale}`;
}
