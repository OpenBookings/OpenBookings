import Link from 'next/link';
import type { GuestNotice } from '@/app/review/_lib/author-notice';

const LINK = 'underline underline-offset-4 hover:text-white';

function Rules({ notice }: { notice: Extract<GuestNotice, { state: 'removed' | 'masked' }> }) {
  return (
    <>
      <p className="leading-relaxed">
        {notice.lead}{' '}
        <Link href="/legal/review-rules" className={LINK}>
          review rules
        </Link>
        {notice.rules.length > 0 ? ':' : '.'}
      </p>
      {notice.rules.length > 0 ? (
        <ul className="list-disc space-y-1.5 pl-5 leading-relaxed">
          {notice.rules.map((rule) => (
            <li key={rule.title}>
              <strong className="font-semibold text-white">{rule.title}</strong>: {rule.description}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Objection({ notice }: { notice: Extract<GuestNotice, { state: 'removed' | 'masked' }> }) {
  return (
    <p className="text-[13px] leading-normal text-white/65">
      Think we got it wrong?{' '}
      <a href={notice.objection.href} className={LINK}>
        Tell us why
      </a>
      , or reply to our email, and we&apos;ll look at it again.
    </p>
  );
}

/**
 * What happened to the guest's own review or answer: held (a line), removed
 * (who, when, the rules, the note, how to object) or published with parts
 * removed (automatic, the rules, what was published and what they wrote).
 * The rewrite offer is the page's: it is only for a review.
 */
export function ModerationNotice({ notice }: { notice: GuestNotice }) {
  if (notice.state === 'held') return <p className="text-sm text-white/55">{notice.text}</p>;

  if (notice.state === 'removed') {
    return (
      <section className="flex flex-col gap-2.5 rounded-xl border border-red-400/35 bg-red-950/30 px-4 py-4 text-[15px] text-white/90 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="rounded-full bg-red-200 px-2.5 py-0.5 text-xs font-bold text-red-900">{notice.pill}</span>
          <span className="text-[13px] text-white/60">{notice.byline}</span>
        </div>
        <Rules notice={notice} />
        {notice.note ? (
          <div className="flex flex-col gap-1 rounded-lg bg-black/25 px-3 py-2.5">
            <span className="text-xs text-white/55">Note from our team</span>
            <span className="leading-relaxed whitespace-pre-line">{notice.note}</span>
          </div>
        ) : null}
        <details className="rounded-lg bg-black/25 px-3 py-2.5">
          <summary className="cursor-pointer text-xs text-white/55 hover:text-white/80">What you wrote (not public)</summary>
          <p className={`mt-1.5 leading-relaxed whitespace-pre-line ${notice.written.purged ? 'text-white/55' : 'text-white/75'}`}>
            {notice.written.text}
          </p>
        </details>
        <Objection notice={notice} />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-amber-300/35 bg-amber-950/30 px-4 py-4 text-[15px] text-white/90 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900">{notice.pill}</span>
      </div>
      <p className="text-[13px] text-white/60">{notice.automatic}</p>
      <Rules notice={notice} />
      {notice.written !== null ? (
        <div className="flex flex-col gap-1 rounded-lg bg-black/25 px-3 py-2.5">
          <span className="text-xs text-white/55">What you wrote</span>
          <span className="leading-relaxed whitespace-pre-line text-white/75">{notice.written}</span>
        </div>
      ) : null}
      <Objection notice={notice} />
    </section>
  );
}
