import Image from "next/image";

const goals = [
  {
    title: "Commission at cost, permanently",
    detail: "The rate exists to keep the lights on, not to fund growth at your expense.",
  },
  {
    title: "Neutral search, always",
    detail: "Ranking is determined by relevance to the guest. It is not, and will never be, for sale.",
  },
  {
    title: "Booking data stays in Europe",
    detail: "EU data residency by architecture — while payment details go straight to Stripe, never through us.",
  },
  {
    title: "You own the relationship",
    detail: "Your guests, your data, exportable any time. We're the pipe, not the gatekeeper.",
  },
];

export function FoundersNote() {
  return (
    <section id="why" className="border-t border-white/5 bg-[#080808] px-6 py-24 sm:px-16 sm:py-[120px]">
      <div className="mx-auto max-w-[1100px]">
        <div className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-28">
          {/* The letter */}
          <div>
            <div className="mb-[18px] text-[11px] font-medium tracking-[0.15em] text-white/45 uppercase">
              Why This Exists
            </div>
            <h2 className="mb-12 font-(family-name:--font-cormorant) text-[44px] leading-[1.04] font-bold tracking-[-1px] text-white sm:text-[62px] sm:tracking-[-1.5px]">
              A note from
              <br />
              the founder.
            </h2>
            <div className="max-w-[58ch] space-y-6 text-[16px] leading-[1.85] font-light text-white/55">
              <p>
                Every year, independent hotels hand a fifth of their revenue to booking platforms — and then
                pay again to rank above their own name in search results. I kept waiting for someone to
                build the obvious alternative: a platform that charges what it actually costs to run, and
                can prove it. Nobody did. So I started building it.
              </p>
              <p>
                OpenBookings charges 4.5% because that&apos;s what covers servers, support, payment
                infrastructure, and development — with enough margin to still exist in ten years. Not
                because a pricing team modelled how much you&apos;d tolerate. And since &ldquo;trust
                me&rdquo; isn&apos;t an argument, the code is public. You can read exactly what happens to
                every booking, every fee, every ranking decision.
              </p>
              <p>
                Booking software should be plumbing: reliable, inspectable, and priced like a utility. If
                that sounds less like a marketplace and more like infrastructure — that&apos;s exactly the
                point.
              </p>
              <div className="flex items-end pt-2">
                <Image
                  src="/founder.png"
                  alt="Wouter van der Wal, founder of OpenBookings"
                  width={176}
                  height={176}
                  className="shrink-0"
                />
                <div>
                  <div className="font-(family-name:--font-allura,cursive) text-[38px] leading-none text-white/85 pb-1">
                    Wouter
                  </div>
                  <div className="text-[12px] text-white/45 pb-1">
                    Founder, OpenBookings
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Goals rail */}
          <div className="lg:pt-24">
            <div className="mb-8 text-[11px] font-medium tracking-[0.15em] text-white/45 uppercase">
              What we&apos;re committed to
            </div>
            <div>
              {goals.map((goal, i) => (
                <div
                  key={goal.title}
                  className={`border-t border-white/6 py-6 ${i === goals.length - 1 ? "border-b" : ""}`}
                >
                  <div className="mb-2 flex items-baseline gap-4">
                    <span className="font-(family-name:--font-cormorant) text-[20px] font-bold text-white/25">
                      0{i + 1}
                    </span>
                    <span className="text-[15px] font-medium tracking-[-0.01em] text-white">{goal.title}</span>
                  </div>
                  <p className="pl-[38px] text-[13px] leading-[1.75] text-white/55">{goal.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
