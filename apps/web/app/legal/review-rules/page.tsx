import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  MASKED_TEXT,
  MODERATION_DEADLINE_HOURS,
  MODERATION_RECORD_RETENTION_MONTHS,
  REVIEW_RULE_IDS,
  REVIEW_RULES,
  REVIEW_WINDOW_DAYS,
} from "@openbookings/pricing";
import { InlineLink, Lead, Section } from "@/components/legal/elements";
import { LegalTOC } from "@/components/legal/LegalTOC";
import { LEGAL_STRINGS } from "@/lib/legal/strings";

export const metadata: Metadata = {
  title: "Review rules | OpenBookings",
  description:
    "The rules every review, reply and answer on OpenBookings follows, how we check them, and how to report a review.",
  alternates: { canonical: "/legal/review-rules" },
};

/**
 * The public review rules, linked from Terms 10.9, Host Agreement 6.5 and the
 * review form. One English page rather than a versioned legal text: the rules
 * come from REVIEW_RULES and the numbers from their constants, so the page
 * can't drift from what the check and the moderators apply.
 */
export default function ReviewRulesPage() {
  const t = LEGAL_STRINGS.en;

  return (
    <div lang="en-GB" className="min-h-screen bg-[oklch(0.1405_0.0044_285.8238)] text-white">
      <header className="sticky top-0 z-30 border-b border-white/6 bg-[oklch(0.1405_0.0044_285.8238)]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
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
            href="/"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60 transition-all hover:bg-white/10 hover:text-white"
          >
            {t.back}
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex gap-16">
          <aside className="hidden w-56 shrink-0 lg:block">
            <div className="sticky top-28">
              <LegalTOC heading={t.onThisPage} navLabel={t.tableOfContents} />
            </div>
          </aside>

          <article className="min-w-0 max-w-2xl flex-1">
            <header className="mb-14">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-white/30">{t.eyebrow}</p>
              <h1 className="mb-4 font-serif text-5xl font-bold tracking-tight text-white">Review rules</h1>
            </header>

            <div className="space-y-14">
              <Lead>
                <p>
                  Reviews help the next guests choose. These rules apply to every review, every reply from a
                  property and every answer from a guest. They are about the words only: the score is never
                  checked, and a low score is never a reason to hold or remove a review.
                </p>
              </Lead>

              <Section id="rules" number="1" title="The rules">
                <ul className="mb-6 space-y-5">
                  {REVIEW_RULE_IDS.map((id) => (
                    <li key={id} className="leading-relaxed text-white/70">
                      <p className="font-medium text-white/90">{REVIEW_RULES[id].title}</p>
                      <p>{REVIEW_RULES[id].description}</p>
                    </li>
                  ))}
                </ul>
                <P>
                  A review must also describe your own stay honestly. Other content rules are in section 10 of
                  our <InlineLink href="/legal/en/terms#messages-and-content">Terms of Service</InlineLink>.
                </P>
              </Section>

              <Section id="checks" number="2" title="How we check">
                <P>
                  When a review, reply or answer is posted, we check its text automatically. First we look for
                  contact details and links. Then a provider based in the EU checks the text against these rules.
                  It gets the text only: never the score, the property, the author or the booking.
                </P>
                <P>If nothing seems to break a rule, it is published straight away.</P>
                <P>
                  If something seems to break a rule, or the check can&apos;t run, it is held until a person at
                  OpenBookings has looked at it.
                </P>
              </Section>

              <Section id="deadline" number="3" title="If nobody decides in time">
                <P>
                  If nobody has decided within {MODERATION_DEADLINE_HOURS} hours, the text is published with the
                  parts that seem to break a rule replaced by &quot;{MASKED_TEXT}&quot;. A person can still
                  remove it after that.
                </P>
              </Section>

              <Section id="decisions" number="4" title="What a person decides">
                <P>A person at OpenBookings makes one of two decisions:</P>
                <ul className="mb-6 space-y-3">
                  <Item>
                    <strong className="font-medium text-white/80">Keep:</strong> it is published as written.
                  </Item>
                  <Item>
                    <strong className="font-medium text-white/80">Remove:</strong> it is taken down, and we name
                    the rule or rules it broke.
                  </Item>
                </ul>
                <P>
                  Nobody edits anyone&apos;s words. Properties can&apos;t approve, hold or remove reviews.
                </P>
                <P>
                  If a guest&apos;s review is removed, they can write it once more while reviews for their stay
                  are open, up to {REVIEW_WINDOW_DAYS} days after check-out. If that one is removed too, they
                  can&apos;t write another.
                </P>
              </Section>

              <Section id="reporting" number="5" title="Reporting a review">
                <P>
                  Properties report a review with <strong className="font-medium text-white/80">Report</strong>{" "}
                  on the review, in Reviews in their dashboard. Anyone else can report a review from the
                  property&apos;s page, with{" "}
                  <strong className="font-medium text-white/80">Report this review</strong>.
                </P>
                <P>
                  A reported review stays visible while a person checks it. We tell whoever reported it what we
                  decided: properties always, anyone else if they gave us an email address.
                </P>
              </Section>

              <Section id="disagree" number="6" title="If you disagree">
                <P>
                  If we remove your review, reply or answer, we email you the rule it broke. If you disagree,
                  reply to that email and tell us why. You can do the same with the email we send about a
                  report.
                </P>
              </Section>

              <Section id="records" number="7" title="How long we keep records">
                <P>
                  Reports, and the text of anything we removed, are deleted {MODERATION_RECORD_RETENTION_MONTHS}{" "}
                  months after the decision. If nobody decided on a text that was published with parts replaced,
                  we keep only that published version from {MODERATION_RECORD_RETENTION_MONTHS} months after it
                  was published. Our <InlineLink href="/legal/en/privacy">Privacy Policy</InlineLink> explains
                  how we handle personal data.
                </P>
              </Section>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 leading-relaxed text-white/70">{children}</p>;
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 leading-relaxed text-white/70">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}
