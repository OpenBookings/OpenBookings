"use client";

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

const OB_RATE = 0.045;
const STRIPE_RATE = 0.015;
const STRIPE_FIXED = 0.25;

const eur = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const DEFAULTS = { rate: 120, bookings: 40, stay: 3 };

function parsePositive(raw: string, fallback: number, max: number): number {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/** Counts from the previous value to the new one whenever `value` changes. */
function CountUpEuro({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const controls = animate(prevRef.current, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    prevRef.current = value;
    return () => controls.stop();
  }, [value]);
  return <span className={className}>{eur.format(Math.round(display))}</span>;
}

export function CostCalculator() {
  // Free-form text while typing; numbers only become "real" on commit.
  const [rateText, setRateText] = useState(String(DEFAULTS.rate));
  const [bookingsText, setBookingsText] = useState(String(DEFAULTS.bookings));
  const [stayText, setStayText] = useState(String(DEFAULTS.stay));
  const [committed, setCommitted] = useState(DEFAULTS);

  const commit = () => {
    setCommitted((prev) => ({
      rate: parsePositive(rateText, prev.rate, 5000),
      bookings: parsePositive(bookingsText, prev.bookings, 5000),
      stay: parsePositive(stayText, prev.stay, 60),
    }));
  };

  // Commit automatically shortly after the user stops typing.
  useEffect(() => {
    const t = setTimeout(commit, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateText, bookingsText, stayText]);

  const annualRevenue = committed.rate * committed.stay * committed.bookings * 12;
  const annualBookings = committed.bookings * 12;
  const obCost = annualRevenue * (OB_RATE + STRIPE_RATE) + annualBookings * STRIPE_FIXED;

  const rows = [
    {
      name: "OpenBookings",
      cost: obCost,
      pct: annualRevenue > 0 ? (obCost / annualRevenue) * 100 : 0,
      highlight: true,
    },
    { name: "Booking.com", cost: annualRevenue * 0.15, pct: 15, highlight: false },
    { name: "Expedia", cost: annualRevenue * 0.18, pct: 18, highlight: false },
  ];
  const maxCost = Math.max(...rows.map((r) => r.cost), 1);
  const saved = Math.max(annualRevenue * 0.15 - obCost, 0);
  const freeNights = committed.rate > 0 ? Math.round(saved / committed.rate) : 0;

  const fields = [
    {
      id: "calc-rate",
      label: "Average nightly rate",
      value: rateText,
      onChange: setRateText,
      prefix: "€",
      suffix: "/ night",
      width: "w-16",
    },
    {
      id: "calc-bookings",
      label: "Bookings per month",
      value: bookingsText,
      onChange: setBookingsText,
      prefix: null,
      suffix: "bookings",
      width: "w-16",
    },
    {
      id: "calc-stay",
      label: "Average length of stay",
      value: stayText,
      onChange: setStayText,
      prefix: null,
      suffix: "nights",
      width: "w-12",
    },
  ];

  return (
    <section id="calculator" className="border-t border-white/5 bg-[#080808] px-6 py-24 sm:px-16 sm:py-[120px]">
      <div className="mx-auto max-w-[1100px]">
        <div className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-24">
          {/* Left — your three numbers */}
          <div>
            <div className="mb-[18px] text-[11px] font-medium tracking-[0.15em] text-white/28 uppercase">
              Your Numbers
            </div>
            <h2 className="mb-8 font-(family-name:--font-cormorant) text-[44px] leading-[1.04] font-bold tracking-[-1px] text-white sm:text-[62px] sm:tracking-[-1.5px]">
              What would
              <br />
              you keep?
            </h2>
            <p className="mb-12 max-w-[48ch] text-[15px] leading-[1.8] text-white/46">
              Three numbers about your property. Change any of them and watch the year&apos;s
              commissions recalculate — ours next to the platforms you&apos;d be leaving.
            </p>

            <div>
              {fields.map((f) => (
                <div
                  key={f.id}
                  className="flex items-baseline justify-between gap-6 border-t border-white/6 py-5 last:border-b"
                >
                  <label htmlFor={f.id} className="text-[14px] text-white/60">
                    {f.label}
                  </label>
                  <div className="flex items-baseline gap-2">
                    {f.prefix && <span className="text-[14px] text-white/28">{f.prefix}</span>}
                    <input
                      id={f.id}
                      inputMode="decimal"
                      value={f.value}
                      onChange={(e) => f.onChange(e.target.value)}
                      onBlur={commit}
                      onKeyDown={(e) => e.key === "Enter" && commit()}
                      className={`${f.width} border-b border-white/20 bg-transparent pb-1 text-right text-[17px] font-medium tracking-[-0.01em] text-white tabular-nums transition-colors outline-none hover:border-white/35 focus:border-[#00C8A8]`}
                    />
                    <span className="w-16 text-[12px] text-white/28">{f.suffix}</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-6 text-[13px] leading-[1.7] text-white/30">
              That&apos;s <span className="text-white/60 tabular-nums">{eur.format(annualRevenue)}</span> in
              booking revenue per year, across{" "}
              <span className="text-white/60 tabular-nums">{annualBookings.toLocaleString("en-IE")}</span>{" "}
              bookings.
            </p>
          </div>

          {/* Right — the year's commissions, set like a payout statement */}
          <div className="lg:pt-24">
            <div className="rounded-2xl border border-white/8 bg-[#0f1115] p-7 sm:p-9">
              <div className="mb-7 flex items-baseline justify-between">
                <span className="text-[11px] font-medium tracking-[0.15em] text-white/28 uppercase">
                  Commission per year
                </span>
                <span className="text-[11px] text-white/25">incl. payment processing</span>
              </div>

              <div className="flex flex-col gap-6">
                {rows.map((row) => (
                  <div key={row.name}>
                    <div className="mb-2 flex items-baseline justify-between gap-4">
                      <span className={`text-[14px] ${row.highlight ? "font-medium text-white" : "text-white/40"}`}>
                        {row.name}
                      </span>
                      <span
                        className={`text-[15px] tracking-[-0.01em] tabular-nums ${
                          row.highlight ? "font-semibold text-[#00C8A8]" : "text-white/40"
                        }`}
                      >
                        {eur.format(row.cost)}
                        <span className="ml-1.5 text-[11px] font-normal text-white/25">{row.pct.toFixed(1)}%</span>
                      </span>
                    </div>
                    <div className="h-[6px] overflow-hidden rounded-full bg-white/5">
                      <div
                        className={`h-full rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                          row.highlight ? "bg-[#00C8A8]" : "bg-white/15"
                        }`}
                        style={{ width: `${Math.max((row.cost / maxCost) * 100, 1.5)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-7 border-t border-white/8 pt-6">
                <div className="mb-1 text-[14px] font-medium text-white">You keep</div>
                <CountUpEuro
                  value={saved}
                  className="font-(family-name:--font-cormorant) text-[42px] leading-none font-bold tracking-[-1px] text-[#00C8A8] tabular-nums"
                />
                <p className="mt-3 text-[13px] leading-[1.7] text-white/40">
                  more than with Booking.com, every year — about{" "}
                  <span className="text-white/70 tabular-nums">{freeNights.toLocaleString("en-IE")}</span>{" "}
                  {freeNights === 1 ? "night" : "nights"} of revenue at your own rate.
                </p>
              </div>
            </div>

            <p className="mt-4 px-1 text-[11px] leading-[1.7] text-white/22">
              Competitor figures are typical published commission rates and vary by market and agreement.
              OpenBookings cost includes Stripe processing (1.5% + €0.25 per booking, standard EEA cards),
              passed through with no markup.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
