const absentFees = [
  { label: "Pay-to-rank placement", note: "Search order is never for sale" },
  { label: "Featured-listing upsells", note: "No visibility you have to buy back" },
  { label: "Guest-side service fees", note: "Your guests pay your price" },
];

export function Mechanism() {
  return (
    <section id="mechanism" className="border-t border-white/5 bg-[#080808] px-6 py-24 sm:px-16 sm:py-[120px]">
      <div className="mx-auto max-w-[1200px]">
        <div className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-24">
          {/* Left — the argument */}
          <div>
            <div className="mb-[18px] text-[11px] font-medium tracking-[0.15em] text-white/28 uppercase">
              The Concept
            </div>
            <h2 className="mb-8 font-(family-name:--font-cormorant) text-[44px] leading-[1.04] font-bold tracking-[-1px] text-white sm:text-[62px] sm:tracking-[-1.5px]">
              4.5%. That&apos;s the
              <br />
              whole model.
            </h2>
            <div className="max-w-[52ch] space-y-6 text-[15px] leading-[1.8] text-white/46">
              <p>
                Every booking costs you exactly two things: Stripe&apos;s payment processing fee, passed
                through at cost, and our <span className="text-white">4.5% commission</span>. There is no
                third line. No commission tiers to climb, no visibility programs, no fees invented on the
                guest&apos;s side of the receipt.
              </p>
              <p>
                <span className="text-white">Why so low?</span>{" "}Because 4.5% is what it actually costs to
                run this; servers, support, infrastructure, development. No padding for a growth budget.
                Bigger commissions often fund bids on your own hotel&apos;s name in search engines, so you&apos;d be
                renting back a guest who was already looking for you. We skip that entirely.
              </p>
              <p>
                <span className="text-white">Why believe it?</span>{" "}Because you don&apos;t have to take
                our word for the fees — the booking engine and fee logic are public code on GitHub. And
                ranking can&apos;t be bought: no host, however large, pays for placement.
              </p>
            </div>
          </div>

          {/* Right — anatomy of a booking, set like a payout statement */}
          <div className="lg:pt-24">
            <div className="rounded-2xl border border-white/8 bg-[#0f1115] p-7 sm:p-9">
              <div className="mb-7 flex items-baseline justify-between">
                <span className="text-[11px] font-medium tracking-[0.15em] text-white/28 uppercase">
                  Anatomy of a booking
                </span>
                <span className="text-[11px] text-white/25">3 nights · €120/night</span>
              </div>

              <div className="space-y-4 text-[14px]">
                <div className="flex items-baseline justify-between">
                  <span className="text-white/60">Guest pays</span>
                  <span className="font-medium tracking-[-0.01em] text-white">€360.00</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-white/40">
                    Stripe processing <span className="text-white/22">· 1.5% + €0.25, at cost</span>
                  </span>
                  <span className="text-white/40">−€5.65</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-white/40">
                    OpenBookings <span className="text-white/22">· 4.5%</span>
                  </span>
                  <span className="text-white/40">−€16.20</span>
                </div>
              </div>

              <div className="mt-5 flex items-baseline justify-between border-t border-white/8 pt-5">
                <span className="text-[14px] font-medium text-white">You receive</span>
                <span className="font-(family-name:--font-cormorant) text-[30px] font-bold tracking-[-0.5px] text-[#00C8A8]">
                  €338.15
                </span>
              </div>

              {/* The line items that don't exist */}
              <div className="mt-8 border-t border-dashed border-white/8 pt-6">
                <div className="mb-4 text-[11px] font-medium tracking-[0.15em] text-white/22 uppercase">
                  Not on this receipt
                </div>
                <div className="space-y-3.5">
                  {absentFees.map((fee) => (
                    <div key={fee.label} className="flex items-baseline justify-between gap-4">
                      <span className="text-[13px] text-white/30 line-through decoration-white/20">
                        {fee.label}
                      </span>
                      <span className="shrink-0 text-right text-[11px] text-white/22">{fee.note}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <p className="mt-4 px-1 text-[11px] leading-[1.7] text-white/22">
              Stripe fee shown for standard EEA cards. We add no markup to payment processing.
            </p>
          </div>
        </div>

        {/* Introducer to the calculator */}
        <div className="mt-20 flex flex-col items-center gap-3 text-center sm:mt-28">
          <p className="font-(family-name:--font-cormorant) text-[26px] font-normal italic tracking-[-0.3px] text-white/60 sm:text-[30px]">
            See what this means for you
          </p>
          <a
            href="#calculator"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white/40 transition-colors hover:border-white/25 hover:text-white/70"
            aria-label="Jump to the cost calculator"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="4" x2="12" y2="20" />
              <polyline points="5 13 12 20 19 13" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
