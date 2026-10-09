import Image from "next/image";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/legal/LanguageSwitcher";
import { LegalTOC } from "@/components/legal/LegalTOC";
import {
  LEGAL_LOCALE_TAGS,
  type LegalDocument as LegalDocumentMeta,
  type LegalLocale,
  type LegalVersion,
  type TranslationStatus,
} from "@/lib/legal/documents";
import { LEGAL_STRINGS } from "@/lib/legal/strings";

function formatDate(iso: string, locale: LegalLocale): string {
  return new Intl.DateTimeFormat(LEGAL_LOCALE_TAGS[locale], {
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
  const t = LEGAL_STRINGS[locale];

  return (
    // `lang` is set on the document rather than in the root layout, which is
    // shared with the English-only rest of the site. Without it a screen
    // reader announces Dutch prose with English pronunciation.
    <div
      lang={LEGAL_LOCALE_TAGS[locale]}
      className="min-h-screen bg-[oklch(0.1405_0.0044_285.8238)] text-white"
    >
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
        {/* Three columns from `sm` up, so the switcher is optically centred
            whatever the logo and the back link happen to measure. Below that
            the row wraps and the switcher takes a line of its own rather than
            being squeezed between two fixed-width neighbours. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-3 px-6 py-4 sm:grid sm:grid-cols-[1fr_auto_1fr]">
          <Link href="/" className="flex items-center gap-2 sm:justify-self-start">
            <Image
              src="https://cdn.openbookings.co/Public/Openbookings-logo-v2.png"
              width={43}
              height={32}
              alt="OpenBookings"
              className="h-8 w-auto"
              draggable="false"
            />
          </Link>
          {availableLocales.length > 1 && (
            <LanguageSwitcher
              locales={availableLocales}
              current={locale}
              label={t.language}
              hrefFor={(code) =>
                href(doc.slug, code, isArchived ? version.version : undefined)
              }
              className="order-last flex w-full justify-center sm:order-none sm:w-auto sm:justify-self-center"
            />
          )}

          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60 transition-all hover:bg-white/10 hover:text-white sm:justify-self-end"
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
            {t.back}
          </Link>
        </div>
      </header>

      {/* Page body */}
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex gap-16">
          {/* Sticky sidebar */}
          <aside className="hidden lg:block w-56 shrink-0">
            <div className="sticky top-28">
              <LegalTOC heading={t.onThisPage} navLabel={t.tableOfContents} />
            </div>
          </aside>

          {/* Main content */}
          <article className="min-w-0 flex-1 max-w-2xl">
            <header className="mb-14">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/30">
                {t.eyebrow}
              </p>
              <h1 className="font-serif mb-4 text-5xl font-bold tracking-tight text-white">
                {title}
              </h1>
              <p className="text-sm text-white/40">
                {t.lastUpdated}{" "}
                <time dateTime={version.lastUpdated}>
                  {formatDate(version.lastUpdated, locale)}
                </time>
                &ensp;·&ensp;{t.effective}{" "}
                <time dateTime={version.effectiveFrom}>
                  {formatDate(version.effectiveFrom, locale)}
                </time>
                &ensp;·&ensp;{t.version}{" "}
                <code className="text-white/50">{version.version}</code>
              </p>
            </header>

            {status === "draft" && (
              <div className="mb-10 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
                <p className="mb-1 font-medium text-amber-200/90">{t.draft.title}</p>
                <p className="text-sm text-amber-100/60">
                  {t.draft.before}
                  <Link
                    href={href(doc.slug, doc.fallbackLocale, isArchived ? version.version : undefined)}
                    hrefLang={LEGAL_LOCALE_TAGS[doc.fallbackLocale]}
                    className="underline underline-offset-2"
                  >
                    {t.draft.authoritative[doc.fallbackLocale]}
                  </Link>
                  {t.draft.after}
                </p>
              </div>
            )}

            {isArchived && (
              <div className="mb-10 rounded-2xl border border-white/10 bg-white/4 p-5">
                <p className="mb-1 font-medium text-white/85">{t.superseded.title}</p>
                <p className="text-sm text-white/50">
                  {t.superseded.beforeVersion}
                  {version.version}
                  {t.superseded.afterVersion}
                  <Link
                    href={href(doc.slug, locale)}
                    className="underline underline-offset-2 text-white/70"
                  >
                    {t.superseded.currentVersion}
                  </Link>
                  {t.superseded.afterLink}
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
