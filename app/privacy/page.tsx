import type { Metadata } from "next";
import Link from "next/link";
import { PrivacyTOC } from "./PrivacyTOC";

export const metadata: Metadata = {
  title: "Privacy Policy — OpenBookings",
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
                <time dateTime="2026-04-15">April 15, 2026</time>
                &ensp;·&ensp;
                Effective:{" "}
                <time dateTime="2026-05-01">May 1, 2026</time>
              </p>
            </header>

            {/* Lead */}
            <div className="mb-12 rounded-2xl border border-white/8 bg-white/3 p-6 backdrop-blur-sm">
              <p className="mb-3 text-base leading-relaxed text-white/70">
                Privacy policies are usually written by lawyers for other lawyers. This one
                isn&apos;t. We&apos;ve tried to write something you can actually read without a
                law degree — covering what we collect, why, and what we do with it.
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
                  policy. We&apos;re a Dutch company, so GDPR applies to us by default — not as a
                  checkbox exercise, but because we actually care about this stuff.
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
                  We only collect data we actually need. Here&apos;s the full list — no surprises.
                </p>

                <div className="space-y-6">
                  <DataCard title="2.1 Account data">
                    <p className="mb-2 text-white/70">
                      Your email address, and optionally your name and profile picture if you sign
                      in via Google or Apple.
                    </p>
                    <Meta why="You need an account to use the platform. That's it." basis="Performance of a contract." />
                  </DataCard>

                  <DataCard title="2.2 Booking data">
                    <p className="mb-2 text-white/70">
                      Guest name, contact details, stay dates, property, number of guests, payment
                      reference, and booking status.
                    </p>
                    <Meta why="To process your booking and handle anything that comes up around it." basis="Performance of a contract." />
                  </DataCard>

                  <DataCard title="2.3 Payment data">
                    <p className="mb-2 text-white/70">
                      We don&apos;t store your card details — that goes straight to Stripe. We only
                      receive a transaction reference, payment status, and the last four digits of
                      your card (just for display).
                    </p>
                    <Meta why="To confirm payment and match it to your booking. Also a legal requirement for financial records." basis="Performance of a contract; legal obligation." />
                  </DataCard>

                  <DataCard title="2.4 Analytics data">
                    <p className="mb-2 text-white/70">
                      Page views, navigation paths, approximate device type, browser, and country.
                      We use PostHog for this, routed through our own domain (
                      <code className="rounded-md bg-white/10 px-1.5 py-0.5 text-sm font-mono text-white/80">
                        e.openbookings.co
                      </code>
                      ) so your browser never talks directly to a third-party analytics server.
                    </p>
                    <p className="mb-4 text-sm text-white/40">
                      We never pass your name, full IP address, or payment details into analytics
                      events.
                    </p>
                    <Meta
                      why="To understand how people use the platform and fix what's broken. Not for ads. Never sold."
                      basis="Consent. Analytics only start if you accept the cookie banner. If you decline (or just ignore it), PostHog doesn't initialise at all — no cookies, no events."
                    />
                    {/* Session replay callout */}
                    <div className="mt-5 rounded-xl border border-white/8 bg-white/3 p-5">
                      <p className="mb-2 font-medium text-white/90">Session replay</p>
                      <p className="mb-4 text-sm text-white/50">
                        We record on-screen interactions to spot usability issues in the booking
                        flow. A few things we want you to know:
                      </p>
                      <ul className="space-y-2">
                        {[
                          "All text inputs are masked. We never see what you type into forms.",
                          "Element attributes are masked by default.",
                          "Recordings are deleted automatically after 30 days.",
                          "This only runs if you've accepted analytics cookies.",
                        ].map((item) => (
                          <li key={item} className="flex items-start gap-3 text-sm text-white/60">
                            <span className="mt-0.5 text-white/25">–</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </DataCard>

                  <DataCard title="2.5 Transactional emails">
                    <p className="mb-2 text-white/70">
                      Your email address plus whatever&apos;s needed for the email — booking
                      confirmations, check-in details, payment receipts, magic link sign-ins.
                    </p>
                    <Meta basis="Performance of a contract." />
                    <p className="mt-3 text-sm italic text-white/40">
                      We don&apos;t do marketing emails. Every email we send is triggered by
                      something you actually did.
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
                    Analytics cookies are set and PostHog starts collecting usage data and session
                    recordings.
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
                  Clear your cookies for this site and the banner comes back.
                </p>

                <p className="mb-4 font-medium text-white/80">What we actually set:</p>
                <StyledTable
                  headers={["Type", "Cookie", "What it does", "Expires", "Needs consent?"]}
                  rows={[
                    ["Essential", "session token", "Keeps you signed in", "Session / configurable", "No"],
                    ["Essential", "cf_clearance", "Cloudflare bot protection", "30 minutes", "No"],
                    ["Essential", "cookieyes-consent", "Remembers your consent choice", "1 year", "No"],
                    ["Analytics", "ph_*", "PostHog analytics & session replay (proxied through our domain)", "1 year", "Yes — EU/EEA"],
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
                  We don&apos;t hold onto data longer than we need to. Here&apos;s what that looks
                  like in practice:
                </p>
                <StyledTable
                  headers={["Data", "Kept for", "Why"]}
                  rows={[
                    ["Account data (email)", "3 years after last login", "In case you come back"],
                    ["Booking records", "7 years from booking date", "Dutch tax / financial records law"],
                    ["Payment references", "7 years", "Dutch legal requirement"],
                    ["Analytics data", "13 months (rolling)", "Year-over-year trend analysis"],
                    ["Session recordings", "30 days", "Usability analysis only"],
                    ["Email logs", "90 days", "Debugging delivery issues"],
                  ]}
                />
                <p className="mt-4 text-sm text-white/40">
                  After these windows close, data is deleted or anonymised. Anonymised data (where
                  you genuinely can&apos;t be identified) may stick around for statistics.
                </p>
              </section>

              {/* 5. Sharing */}
              <section id="sharing" className="scroll-mt-28">
                <SectionHeading number="5" title="Who we share your data with" />
                <p className="mb-6 leading-relaxed text-white/70">
                  We don&apos;t sell your data. Full stop. We share it only with the vendors we
                  need to actually run the platform:
                </p>
                <StyledTable
                  headers={["Vendor", "What they get", "What for", "Where"]}
                  rows={[
                    ["Stripe", "Name, email, booking amount", "Payment processing and host payouts", "US/EU (SCCs)"],
                    ["Google Cloud", "Everything we store", "Hosting and infrastructure", "EU (europe-west)"],
                    ["Cloudflare", "IP address, request metadata", "CDN, DDoS and bot protection", "EU/US (SCCs)"],
                    ["Postmark", "Email address, booking details", "Sending transactional emails", "US (SCCs)"],
                    ["PostHog", "Usage events, session recordings (no PII)", "Product analytics", "EU (PostHog Cloud EU)"],
                    ["CookieYes", "Your consent preference", "Cookie consent management", "EU"],
                  ]}
                  boldFirstCol
                />
                <p className="mt-4 text-sm text-white/40">
                  For vendors outside the EU (Stripe, Postmark, Cloudflare), we use Standard
                  Contractual Clauses (SCCs) approved by the European Commission. Boring but
                  important.
                </p>
                <p className="mt-2 text-sm text-white/40">
                  We&apos;ll also hand over data if a court tells us to. We don&apos;t have much
                  choice in that situation.
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
                    "Secrets live in a Secret Manager, not in code or environment variable leaks.",
                    "Infrastructure is on Google Cloud with access controls and audit logging.",
                    "Payment data never touches our servers — Stripe handles all of that.",
                    "Session recordings are masked so we never capture sensitive inputs.",
                    "Auth runs entirely on our own infrastructure via Better Auth — no third-party auth processors.",
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
                  If you&apos;re in the EEA, you have real enforceable rights over your data — not
                  just a list we&apos;re legally required to include.
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
                    <strong className="text-white/70">30 days</strong>. No fee, unless your
                    request is clearly excessive.
                  </p>
                  <p>
                    Not happy with how we&apos;ve handled something? You can file a complaint
                    with the Dutch Data Protection Authority (Autoriteit Persoonsgegevens) at{" "}
                    <InlineLink
                      href="https://www.autoriteitpersoonsgegevens.nl"
                      external
                    >
                      autoriteitpersoonsgegevens.nl
                    </InlineLink>
                    , or with the authority in your own country.
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

              {/* 10. Open source */}
              <section id="open-source" className="scroll-mt-28">
                <SectionHeading number="10" title="We're open source" />
                <p className="leading-relaxed text-white/70">
                  Our codebase is public. That doesn&apos;t change anything about your privacy —
                  this policy applies regardless of how the software is deployed. If you&apos;re
                  self-hosting it, you&apos;re the data controller for your own installation and
                  this policy doesn&apos;t cover you.
                </p>
              </section>

              {/* 11. Changes */}
              <section id="changes" className="scroll-mt-28">
                <SectionHeading number="11" title="Changes to this policy" />
                <p className="mb-4 leading-relaxed text-white/70">
                  We&apos;ll update this from time to time. When something material changes:
                </p>
                <ul className="space-y-3">
                  {[
                    'The "Last updated" date at the top changes.',
                    "We'll email you before material changes take effect.",
                    "Continuing to use the platform after that means you're good with the update.",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-white/70">
                      <span className="mt-0.5 text-white/25">–</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              {/* 12. Contact */}
              <section id="contact" className="scroll-mt-28">
                <SectionHeading number="12" title="Get in touch" />
                <div className="rounded-2xl border border-white/8 bg-white/3 p-6 backdrop-blur-sm">
                  <p className="text-white/70">
                    Privacy questions, data requests, or just want to know more about how this
                    works —{" "}
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
