import type { Metadata } from "next";
import {
  MASKED_TEXT,
  MODERATION_DEADLINE_HOURS,
  MODERATION_RECORD_RETENTION_MONTHS,
  REVIEW_RULE_IDS,
  REVIEW_RULES,
  REVIEW_RULES_LAST_UPDATED,
  REVIEW_WINDOW_DAYS,
} from "@openbookings/pricing";
import { InlineLink, Lead, Section } from "@/components/legal/elements";
import { LegalDocument } from "@/components/legal/LegalDocument";
import type { LegalDocument as LegalDocumentMeta, LegalVersion } from "@/lib/legal/documents";

export const metadata: Metadata = {
  title: "Review rules | OpenBookings",
  description:
    "The rules every review, reply and answer on OpenBookings follows, how we check them, and how to report a review.",
  alternates: { canonical: "/legal/review-rules" },
};

/**
 * The public review rules, linked from Terms 10.9, Host Agreement 6.5 and the
 * review form. One English page rather than a registered legal text: the rules
 * come from REVIEW_RULES and the numbers from their constants, so the page
 * can't drift from what the check and the moderators apply. It borrows the
 * legal page shell; with no locales listed, the shell shows no language switcher.
 */
const VERSION: LegalVersion = {
  version: REVIEW_RULES_LAST_UPDATED,
  effectiveFrom: REVIEW_RULES_LAST_UPDATED,
  lastUpdated: REVIEW_RULES_LAST_UPDATED,
  locales: {},
};
const DOC: LegalDocumentMeta = {
  slug: "review-rules",
  fallbackLocale: "en",
  currentVersion: VERSION.version,
  versions: [VERSION],
};

export default function ReviewRulesPage() {
  return (
    <LegalDocument doc={DOC} version={VERSION} locale="en" status="translated" title="Review rules" isArchived={false}>
      <Lead>
        <p>
          Reviews help the next guests choose. These rules apply to every review, every reply from a property and
          every answer from a guest. They are about the words only: the score is never checked, and a low score is
          never a reason to hold or remove a review.
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
          A review must also describe your own stay honestly. Other content rules are in section 10 of our{" "}
          <InlineLink href="/legal/en/terms#messages-and-content">Terms of Service</InlineLink>.
        </P>
      </Section>

      <Section id="checks" number="2" title="How we check">
        <P>
          When a review, reply or answer is posted, we check its text automatically. First we look for contact
          details and links. Then a provider based in the EU checks the text against these rules. It gets the text
          only: never the score, the property, the author or the booking.
        </P>
        <P>If nothing seems to break a rule, it is published straight away.</P>
        <P>
          If something seems to break a rule, or the check can&apos;t run, it is held until a person at OpenBookings
          has looked at it.
        </P>
      </Section>

      <Section id="deadline" number="3" title="If nobody decides in time">
        <P>
          If nobody has decided within {MODERATION_DEADLINE_HOURS} hours, the text is published automatically, with
          the parts that seem to break a rule replaced by &quot;{MASKED_TEXT}&quot;. A person can still remove it after
          that.
        </P>
      </Section>

      <Section id="decisions" number="4" title="What a person decides">
        <P>A person at OpenBookings makes one of two decisions:</P>
        <ul className="mb-6 space-y-3">
          <Item>
            <Strong>Keep:</Strong> it is published as written.
          </Item>
          <Item>
            <Strong>Remove:</Strong> it is taken down, and we name the rule or rules it broke.
          </Item>
        </ul>
        <P>
          OpenBookings never removes a review for its score or because it is negative: only for breaking these rules,
          or where the law requires it. Nobody edits anyone&apos;s words. Properties can&apos;t approve, hold or
          remove reviews.
        </P>
        <P>
          If a guest&apos;s review is removed, they can write it once more while reviews for their stay are open, up
          to {REVIEW_WINDOW_DAYS} days after check-out. If that one is removed too, they can&apos;t write another.
        </P>
      </Section>

      <Section id="telling-you" number="5" title="What we tell you">
        <P>
          If we remove your review, reply or answer, or it is published at the deadline with parts replaced, we send
          you a short email with a link to your review. Guests see it on their review page, properties in Reviews in
          their dashboard. There you see what happened and why: the rule or rules involved, which parts were
          replaced, any note from the person who decided, and whether it was decided automatically.
        </P>
        <P>
          If you disagree, reply to that email or contact{" "}
          <InlineLink href="mailto:support@openbookings.co">support@openbookings.co</InlineLink>. If your review,
          reply or answer is kept, we don&apos;t email you. People who reported it do hear the outcome, as section 6
          explains.
        </P>
      </Section>

      <Section id="reporting" number="6" title="Reporting a review">
        <P>
          Properties report a review with <Strong>Report</Strong> on the review, in Reviews in their dashboard. We
          email them the outcome, and it shows on their Reviews page.
        </P>
        <P>
          Anyone can report a review from the property&apos;s page, with <Strong>Report this review</Strong>. If
          you&apos;re signed in, you can tick to receive updates by email, and we send the outcome to your
          account&apos;s email address. If you&apos;re not signed in, you can still report, but we can&apos;t tell
          you the outcome.
        </P>
        <P>A reported review stays visible while a person checks it.</P>
      </Section>

      <Section id="records" number="7" title="How long we keep records">
        <P>
          Reports, and the text of anything we removed, are deleted {MODERATION_RECORD_RETENTION_MONTHS} months
          after the decision. A report nobody decided on is deleted {MODERATION_RECORD_RETENTION_MONTHS} months after
          it was made. If nobody decided on a text that was published with parts replaced, we keep only that
          published version from {MODERATION_RECORD_RETENTION_MONTHS} months after it was published. Our{" "}
          <InlineLink href="/legal/en/privacy">Privacy Policy</InlineLink> explains how we handle personal data.
        </P>
      </Section>
    </LegalDocument>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 leading-relaxed text-white/70">{children}</p>;
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-white/80">{children}</strong>;
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 leading-relaxed text-white/70">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}
