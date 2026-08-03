import type { Metadata } from "next";
import Link from "next/link";
import { PrivacyTOC } from "./PrivacyTOC";

export const metadata: Metadata = {
  title: "Privacy Policy | OpenBookings",
  description:
    "How OpenBookings collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
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
              src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
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
            <div className="sticky top-28">
              <PrivacyTOC />
            </div>
          </aside>

          {/* Main content */}
          <article className="min-w-0 flex-1 max-w-2xl">
            {/* Header */}
            <header className="mb-14">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/30">
                Legal
              </p>
              <h1 className="font-serif mb-4 text-5xl font-bold tracking-tight text-white">
                Privacy Policy
              </h1>
              <p className="text-sm text-white/40">
                Last updated:{" "}
                <time dateTime="2026-07-27">July 27, 2026</time>
                &ensp;·&ensp;
                Effective:{" "}
                <time dateTime="2026-08-01">August 1, 2026</time>
              </p>
            </header>

            {/* Lead */}
            <div className="mb-12 rounded-2xl border border-white/8 bg-white/3 p-6 backdrop-blur-sm">
              <p className="mb-3 text-base leading-relaxed text-white/70">
                Written to be read, not decoded. What we collect, why, and what we do with it.
              </p>
              <p className="text-base leading-relaxed text-white/70">
                This policy applies to{" "}
                <a
                  href="https://openbookings.co"
                  className="text-white underline underline-offset-2 decoration-white/30 hover:decoration-white/70 transition-all"
                >
                  openbookings.co
                </a>{" "}
                and all related services operated by OpenBookings B.V., registered in the
                Netherlands.
              </p>
            </div>

            {/* Sections */}
            <div className="space-y-14">

              {/* 1. Who we are */}
              <section id="who-we-are" className="scroll-mt-28">
                <SectionHeading number="1" title="Who we are" />
                <p className="mb-3 leading-relaxed text-white/70">
                  OpenBookings B.V. is the data controller for everything described in this
                  policy. We&apos;re a Dutch company, so GDPR applies.
                </p>
                <p className="leading-relaxed text-white/70">
                  Questions? Email us at{" "}
                  <InlineLink href="mailto:privacy@openbookings.co">
                    privacy@openbookings.co
                  </InlineLink>
                  . We&apos;ll get back to you within 5 business days.
                </p>
              </section>

              {/* 2. What we collect */}
              <section id="what-we-collect" className="scroll-mt-28">
                <SectionHeading number="2" title="What we collect and why" />
                <p className="mb-8 leading-relaxed text-white/50">
                  We only collect data we actually need. Here&apos;s the full list.
                </p>

                <div className="space-y-6">
                  <DataCard title="2.1 Account data">
                    <p className="mb-2 text-white/70">
                      Your email address, name and your profile picture when you sign in with
                      Google.
                    </p>
                    <Meta why="You need an account to use the platform." basis="Performance of a contract." />
                  </DataCard>

                  <DataCard title="2.2 Booking data">
                    <p className="mb-2 text-white/70">
                      Guest name, contact details, and booking details: stay dates, property,
                      number of guests, payment reference, and status.
                    </p>
                    <p className="text-sm text-white/40">
                      Card details never reach our servers. Stripe handles those; we only receive
                      the payment reference.
                    </p>
                    <Meta why="To process your booking and handle anything that comes up around it." basis="Performance of a contract; legal obligation for financial records." />
                  </DataCard>

                  <DataCard title="2.3 Analytics data">
                    <p className="mb-2 text-white/70">
                      Page views, navigation paths, approximate device type, browser, and country.
                    </p>
                    <p className="mb-4 text-sm text-white/40">
                      Via PostHog. We never pass your name, full IP address, or payment details
                      into analytics events.
                    </p>
                    <Meta
                      why="To understand usage and fix issues."
                      basis="Consent, via the cookie banner. No acceptance, nothing tracked."
                    />
                    {/* Session replay callout */}
                    <div className="mt-5 rounded-xl border border-white/8 bg-white/3 p-5">
                      <p className="mb-2 font-medium text-white/90">Session replay</p>
                      <p className="mb-4 text-sm text-white/50">
                        We record on-screen interactions to spot usability issues in the booking
                        flow.
                      </p>
                      <ul className="space-y-2">
                        {[
                          "All text is masked. We never see what you type into forms.",
                          "Recordings are deleted automatically after 30 days.",
                          "Only runs if you accept analytics cookies.",
                        ].map((item) => (
                          <li key={item} className="flex items-start gap-3 text-sm text-white/60">
                            <span className="mt-0.5 text-white/25">–</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </DataCard>

                  <DataCard title="2.4 Error data">
                    <p className="mb-2 text-white/70">
                      When something breaks, Sentry receives the error, a stack trace, the page you
                      were on, and your browser type. No form contents, no payment details.
                    </p>
                    <Meta why="To find and fix bugs." basis="Legitimate interest in keeping the platform working." />
                  </DataCard>

                  <DataCard title="2.5 Transactional emails">
                    <p className="mb-2 text-white/70">
                      Your email address and the details needed for the message: booking
                      confirmations, check-in details, receipts, and sign-in links.
                    </p>
                    <Meta basis="Performance of a contract." />
                    <p className="mt-3 text-sm italic text-white/40">
                      No marketing emails. Every email is triggered by something you did.
                    </p>
                  </DataCard>
                </div>
              </section>

              {/* 3. Cookies */}
              <section id="cookies" className="scroll-mt-28">
                <SectionHeading number="3" title="Cookies" />
                <p className="mb-4 leading-relaxed text-white/70">
                  When you first visit, you&apos;ll see a cookie banner. Your choices are simple:
                </p>
                <ul className="mb-6 space-y-3">
                  <li className="flex items-start gap-3 text-white/70">
                    <span className="mt-0.5 shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/60">
                      Accept
                    </span>
                    PostHog starts, collecting usage data and session recordings.
                  </li>
                  <li className="flex items-start gap-3 text-white/70">
                    <span className="mt-0.5 shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/60">
                      Decline
                    </span>
                    Nothing analytics-related gets set. PostHog doesn&apos;t run at all.
                  </li>
                </ul>
                <p className="mb-8 text-sm text-white/40">
                  EU/EEA visitors see this banner until they make a choice. Changed your mind?
                  Clear this site&apos;s storage and the banner comes back.
                </p>

                <p className="mb-4 font-medium text-white/80">What we actually set:</p>
                <StyledTable
                  headers={["Type", "Name", "What it does", "Expires", "Needs consent?"]}
                  rows={[
                    ["Essential", "session token", "Keeps you signed in", "Session / configurable", "No"],
                    ["Essential", "cf_clearance", "Cloudflare bot protection", "30 minutes", "No"],
                    ["Essential", "ob_cookie_consent", "Remembers your consent choice (local storage, our own banner)", "90 days", "No"],
                    ["Analytics", "ph_*", "PostHog analytics and session replay", "1 year", "Yes, EU/EEA"],
                  ]}
                  codeCols={[1]}
                />
                <p className="mt-4 text-sm text-white/40">
                  No advertising cookies. No tracking pixels. No social media cookies.
                </p>
              </section>

              {/* 4. Retention */}
              <section id="retention" className="scroll-mt-28">
                <SectionHeading number="4" title="How long we keep things" />
                <p className="mb-6 leading-relaxed text-white/50">
                  We don&apos;t hold onto data longer than we need to.
                </p>
                <StyledTable
                  headers={["Data", "Kept for", "Why"]}
                  rows={[
                    ["Account data", "3 years after last login", "In case you come back"],
                    ["Booking records", "7 years from booking date", "Dutch tax and financial records law"],
                    ["Analytics data", "13 months (rolling)", "Year-over-year trend analysis"],
                    ["Session recordings", "30 days", "Usability analysis only"],
                    ["Error reports", "90 days", "Debugging"],
                    ["Email logs", "90 days", "Debugging delivery issues"],
                  ]}
                />
                <p className="mt-4 text-sm text-white/40">
                  After these windows close, data is deleted or anonymised. Anonymised data may
                  stick around for statistics.
                </p>
              </section>

              {/* 5. Sharing */}
              <section id="sharing" className="scroll-mt-28">
                <SectionHeading number="5" title="Who we share your data with" />
                <p className="mb-6 leading-relaxed text-white/70">
                  We don&apos;t sell your data. We share it only with the vendors we need to run
                  the platform:
                </p>
                <StyledTable
                  headers={["Vendor", "What they get", "What for", "Where"]}
                  rows={[
                    ["Neon", "Account and booking records", "Database hosting", "EU (West)"],
                    ["Google Cloud", "Data processed by the app while it runs", "Application hosting and infrastructure", "EU (West)"],
                    ["Algolia", "Search queries, IP address", "Destination search", "EU (Central)"],
                    ["Lettermint", "Email address, booking details", "Sending transactional emails", "EU"],
                    ["PostHog", "Usage events, session recordings (no PII)", "Product analytics", "EU"],
                    ["Sentry", "Error reports, stack traces, browser type", "Error tracking", "EU"],
                    ["Cloudflare", "IP address, request metadata", "CDN, DDoS and bot protection", "EU/US (SCCs)"],
                    ["Stripe", "Name, email, booking amount", "Payment processing and host payouts", "US/EU (SCCs)"],
                  ]}
                  boldFirstCol
                />
                <p className="mt-4 text-sm text-white/40">
                  For the last two, where data can leave the EU, we use Standard Contractual
                  Clauses approved by the European Commission.
                </p>
                <p className="mt-2 text-sm text-white/40">
                  We&apos;ll also hand over data if a court orders it.
                </p>
              </section>

              {/* 6. Security */}
              <section id="security" className="scroll-mt-28">
                <SectionHeading number="6" title="Security" />
                <p className="mb-5 leading-relaxed text-white/70">
                  Here&apos;s what we do to keep your data safe:
                </p>
                <ul className="space-y-3">
                  {[
                    "Everything travels over encrypted connections (TLS).",
                    "Secrets live in a Secret Manager, not in code.",
                    "Infrastructure is on Google Cloud with access controls and audit logging.",
                    "Card details never touch our servers. Stripe handles all of that.",
                    "Session recordings are masked, so we never capture sensitive inputs.",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-white/70">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 text-sm text-white/40">
                  No system is completely bulletproof. If we ever find out your data was
                  compromised, we&apos;ll tell you and the relevant authority as required by law.
                </p>
              </section>

              {/* 7. Your rights */}
              <section id="your-rights" className="scroll-mt-28">
                <SectionHeading number="7" title="Your rights under GDPR" />
                <p className="mb-6 leading-relaxed text-white/70">
                  If you&apos;re in the EEA, you have enforceable rights over your data.
                </p>
                <StyledTable
                  headers={["Right", "What it means for you"]}
                  rows={[
                    ["Access", "Get a copy of everything we hold about you."],
                    ["Rectification", "Ask us to fix anything that's wrong or incomplete."],
                    ["Erasure", "Ask us to delete your data. We'll do it, within the limits of what the law requires us to keep."],
                    ["Restriction", "Ask us to pause processing while something's being sorted out."],
                    ["Portability", "Get your data in a machine-readable format."],
                    ["Object", "Push back on processing based on legitimate interests."],
                    ["Withdraw consent", "Pull back your consent for analytics at any time. Doesn't affect anything that already happened."],
                  ]}
                  boldFirstCol
                />
                <div className="mt-5 space-y-2 text-sm text-white/40">
                  <p>
                    Email{" "}
                    <InlineLink href="mailto:privacy@openbookings.co">
                      privacy@openbookings.co
                    </InlineLink>{" "}
                    and we&apos;ll respond within{" "}
                    <strong className="text-white/70">30 days</strong>. 
                    <br />No fee, unless your request is clearly excessive.
                  </p>
                </div>
              </section>

              {/* 8. Automated decisions */}
              <section id="automated-decisions" className="scroll-mt-28">
                <SectionHeading number="8" title="Automated decision-making" />
                <p className="leading-relaxed text-white/70">
                  We don&apos;t make automated decisions about you that have legal or significant
                  effects. We don&apos;t profile you for advertising. There&apos;s no algorithm
                  quietly judging you.
                </p>
              </section>

              {/* 9. Children */}
              <section id="children" className="scroll-mt-28">
                <SectionHeading number="9" title="Children's privacy" />
                <p className="leading-relaxed text-white/70">
                  OpenBookings is not for anyone under 16. If you think a child has somehow ended
                  up with an account, email{" "}
                  <InlineLink href="mailto:privacy@openbookings.co">
                    privacy@openbookings.co
                  </InlineLink>{" "}
                  and we&apos;ll delete it.
                </p>
              </section>

              {/* 10. Changes */}
              <section id="changes" className="scroll-mt-28">
                <SectionHeading number="10" title="Changes to this policy" />
                <p className="mb-4 leading-relaxed text-white/70">
                  We&apos;ll update this from time to time. When something material changes:
                </p>
                <ul className="space-y-3">
                  {[
                    'The "Last updated" date at the top changes.',
                    "We'll re-show the cookie banner.",
                    "Continuing to use the platform after that means you're good with the update.",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-white/70">
                      <span className="mt-0.5 text-white/25">–</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              {/* 11. Contact */}
              <section id="contact" className="scroll-mt-28">
                <SectionHeading number="11" title="Get in touch" />
                <div className="rounded-2xl border border-white/8 bg-white/3 p-6 backdrop-blur-sm">
                  <p className="text-white/70">
                    Privacy questions or data requests:{" "}
                    <a
                      href="mailto:privacy@openbookings.co"
                      className="font-medium text-white underline underline-offset-2 decoration-white/30 hover:decoration-white/70 transition-all"
                    >
                      privacy@openbookings.co
                    </a>
                    .
                  </p>
                </div>
              </section>

            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

/* ── Shared sub-components ── */

function SectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="mb-5 flex items-baseline gap-3">
      <span className="shrink-0 text-sm font-semibold text-white/40">{number}.</span>
      <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
    </div>
  );
}

function DataCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/7 bg-white/2.5 p-5">
      <h3 className="mb-3 font-semibold text-white/90">{title}</h3>
      {children}
    </div>
  );
}

function Meta({ why, basis }: { why?: string; basis?: string }) {
  return (
    <div className="mt-3 space-y-1 text-sm text-white/40">
      {why && (
        <p>
          <strong className="text-white/50">Why:</strong> {why}
        </p>
      )}
      {basis && (
        <p>
          <strong className="text-white/50">Legal basis:</strong> {basis}
        </p>
      )}
    </div>
  );
}

function InlineLink({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="text-white underline underline-offset-2 decoration-white/30 hover:decoration-white/70 transition-all"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

function StyledTable({
  headers,
  rows,
  codeCols = [],
  boldFirstCol = false,
}: {
  headers: string[];
  rows: string[][];
  codeCols?: number[];
  boldFirstCol?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/7 bg-white/3">
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/40"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-white/4 last:border-0 transition-colors hover:bg-white/2"
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`px-4 py-3 leading-snug ${
                    boldFirstCol && ci === 0
                      ? "font-medium text-white/80"
                      : "text-white/60"
                  }`}
                >
                  {codeCols.includes(ci) ? (
                    <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-white/70">
                      {cell}
                    </code>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
