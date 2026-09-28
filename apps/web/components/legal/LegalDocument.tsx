import Link from "next/link";
import { LegalTOC } from "@/components/legal/LegalTOC";
import {
  LEGAL_LOCALE_LABELS,
  type LegalDocument as LegalDocumentMeta,
  type LegalLocale,
  type LegalVersion,
  type TranslationStatus,
} from "@/lib/legal/documents";

const LOCALE_TAGS: Record<LegalLocale, string> = {
  en: "en-GB",
  nl: "nl-NL",
  fr: "fr-BE",
};

function formatDate(iso: string, locale: LegalLocale): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${iso}T00:00:00Z`));
}

function href(slug: string, locale: LegalLocale, version?: string): string {
  return version
    ? `/legal/${locale}/${slug}/v/${version}`
    : `/legal/${locale}/${slug}`;
}

export function LegalDocument({
  doc,
  version,
  locale,
  status,
  title,
  isArchived,
  children,
}: {
  doc: LegalDocumentMeta;
  version: LegalVersion;
  /** The locale actually rendered, which may differ from the one requested. */
  locale: LegalLocale;
  status: TranslationStatus;
  title: string;
  isArchived: boolean;
  children: React.ReactNode;
}) {
  const availableLocales = Object.keys(version.locales) as LegalLocale[];

  return (
    <div className="min-h-screen bg-[oklch(0.1405_0.0044_285.8238)] text-white">
      {/* Subtle gradient overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,255,255,0.04) 0%, transparent 70%)",
        }}
      />

      {/* Top nav */}
      <header className="sticky top-0 z-30 border-b border-white/6 bg-[oklch(0.1405_0.0044_285.8238)]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <img
              src="https://cdn.openbookings.co/Public/Openbookings-logo-v2.png"
              alt="OpenBookings"
              className="h-8 w-auto"
              draggable="false"
            />
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60 transition-all hover:bg-white/10 hover:text-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back
          </Link>
        </div>
      </header>

      {/* Page body */}
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex gap-16">
          {/* Sticky sidebar */}
          <aside className="hidden lg:block w-56 shrink-0">
            <div className="sticky top-28 space-y-8">
              <LegalTOC />

              {availableLocales.length > 1 && (
                <nav aria-label="Language">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/30">
                    Language
                  </p>
                  <ul className="space-y-1">
                    {availableLocales.map((code) => (
                      <li key={code}>
                        <Link
                          href={href(doc.slug, code, isArchived ? version.version : undefined)}
                          hrefLang={LOCALE_TAGS[code]}
                          className={`block rounded-lg px-3 py-1.5 text-sm transition-all duration-150 ${
                            code === locale
                              ? "bg-white/10 font-medium text-white"
                              : "text-white/40 hover:bg-white/5 hover:text-white/70"
                          }`}
                        >
                          {LEGAL_LOCALE_LABELS[code]}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>
          </aside>

          {/* Main content */}
          <article className="min-w-0 flex-1 max-w-2xl">
            <header className="mb-14">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/30">
                Legal
              </p>
              <h1 className="font-serif mb-4 text-5xl font-bold tracking-tight text-white">
                {title}
              </h1>
              <p className="text-sm text-white/40">
                Last updated:{" "}
                <time dateTime={version.lastUpdated}>
                  {formatDate(version.lastUpdated, locale)}
                </time>
                &ensp;·&ensp;Effective:{" "}
                <time dateTime={version.effectiveFrom}>
                  {formatDate(version.effectiveFrom, locale)}
                </time>
                &ensp;·&ensp;Version <code className="text-white/50">{version.version}</code>
              </p>
            </header>

            {status === "draft" && (
              <div className="mb-10 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
                <p className="mb-1 font-medium text-amber-200/90">
                  Unreviewed translation
                </p>
                <p className="text-sm text-amber-100/60">
                  This translation has not been through legal review and is not the
                  authoritative version. The{" "}
                  <Link
                    href={href(doc.slug, doc.fallbackLocale, isArchived ? version.version : undefined)}
                    className="underline underline-offset-2"
                  >
                    {LEGAL_LOCALE_LABELS[doc.fallbackLocale]} version
                  </Link>{" "}
                  governs.
                </p>
              </div>
            )}

            {isArchived && (
              <div className="mb-10 rounded-2xl border border-white/10 bg-white/4 p-5">
                <p className="mb-1 font-medium text-white/85">Superseded version</p>
                <p className="text-sm text-white/50">
                  You are reading version {version.version}, kept available because it
                  governs anything agreed while it was in force. The{" "}
                  <Link
                    href={href(doc.slug, locale)}
                    className="underline underline-offset-2 text-white/70"
                  >
                    current version
                  </Link>{" "}
                  applies to everything else.
                </p>
              </div>
            )}

            <div className="space-y-14">{children}</div>
          </article>
        </div>
      </div>
    </div>
  );
}
