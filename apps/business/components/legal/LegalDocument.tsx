import Image from "next/image";
import Link from "next/link";
import { HOST_AGREEMENT_PATH } from "@openbookings/authz/host-agreement";
import { LegalTOC } from "@/components/legal/LegalTOC";
import type { HostAgreementVersion } from "@/lib/legal/host-agreement";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * The page around a legal document: the layout of the guest Privacy Policy
 * and Terms (apps/web/components/legal/LegalDocument.tsx), so the Host
 * Agreement reads like the rest of our legal texts.
 *
 * English only: the agreement is authoritative in English and has no
 * translations, so the language switcher and draft-translation banner of the
 * web version are left out.
 */
export function LegalDocument({
  version,
  title,
  isArchived,
  children,
}: {
  version: HostAgreementVersion;
  title: string;
  isArchived: boolean;
  children: React.ReactNode;
}) {
  return (
    <div lang="en" className="min-h-screen bg-[oklch(0.1405_0.0044_285.8238)] text-white">
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
          <Link href="/dashboard" className="flex items-center gap-2">
            <Image
              src="https://cdn.openbookings.co/Public/Openbookings-logo-v2.png"
              width={96}
              height={72}
              alt="OpenBookings"
              className="h-8 w-auto"
              draggable="false"
            />
          </Link>

          <Link
            href="/dashboard"
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
            <div className="sticky top-28">
              <LegalTOC heading="On this page" navLabel="Table of contents" />
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
                <time dateTime={version.lastUpdated}>{formatDate(version.lastUpdated)}</time>
                &ensp;·&ensp;Effective:{" "}
                <time dateTime={version.effectiveFrom}>{formatDate(version.effectiveFrom)}</time>
                &ensp;·&ensp;Version <code className="text-white/50">{version.version}</code>
              </p>
            </header>

            {isArchived && (
              <div className="mb-10 rounded-2xl border border-white/10 bg-white/4 p-5">
                <p className="mb-1 font-medium text-white/85">Superseded version</p>
                <p className="text-sm text-white/50">
                  You are reading version {version.version}, kept available because it governs
                  anything agreed while it was in force. The{" "}
                  <Link href={HOST_AGREEMENT_PATH} className="underline underline-offset-2 text-white/70">
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
