"use client";

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";

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
    },
    {
      id: "calc-bookings",
      label: "Bookings per month",
      value: bookingsText,
      onChange: setBookingsText,
      prefix: null,
      suffix: "bookings",
    },
    {
      id: "calc-stay",
      label: "Average length of stay",
      value: stayText,
      onChange: setStayText,
      prefix: null,
      suffix: "nights",
    },
  ];

  return (
    <section id="calculator" className="border-t border-white/5 bg-[#080808] px-6 py-24 sm:px-16 sm:py-[120px]">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-[18px] text-center text-[11px] font-medium tracking-[0.15em] text-white/28 uppercase">
          Your Numbers
        </div>
        <h2 className="mb-16 text-center font-(family-name:--font-cormorant) text-[40px] leading-[1.04] font-bold tracking-[-1px] text-white sm:mb-20 sm:text-[62px] sm:tracking-[-1.5px]">
          What would you keep?
        </h2>

        <Card className="overflow-hidden rounded-[20px] py-0">
          <div className="grid lg:grid-cols-[360px_minmax(0,1fr)]">
            {/* Inputs */}
            <div className="border-b border-border p-8 sm:p-10 lg:border-r lg:border-b-0">
              <FieldGroup>
                {fields.map((f) => (
                  <Field key={f.id}>
                    <FieldLabel htmlFor={f.id}>{f.label}</FieldLabel>
                    <InputGroup>
                      {f.prefix && (
                        <InputGroupAddon align="inline-start">
                          <InputGroupText>{f.prefix}</InputGroupText>
                        </InputGroupAddon>
                      )}
                      <InputGroupInput
                        id={f.id}
                        inputMode="decimal"
                        value={f.value}
                        onChange={(e) => f.onChange(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => e.key === "Enter" && commit()}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>{f.suffix}</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                ))}
              </FieldGroup>
              <p className="mt-8 border-t border-border pt-6 text-[13px] leading-[1.7] text-muted-foreground">
                {eur.format(annualRevenue)} in booking revenue per year, across{" "}
                {annualBookings.toLocaleString("en-IE")} bookings.
              </p>
            </div>

            {/* Results */}
            <div className="flex flex-col justify-between p-8 sm:p-10">
              <div>
                <div className="mb-7 text-[11px] font-medium tracking-[0.15em] text-white/28 uppercase">
                  Commission per year
                </div>
                <div className="flex flex-col gap-6">
                  {rows.map((row) => (
                    <div key={row.name}>
                      <div className="mb-2 flex items-baseline justify-between gap-4">
                        <span className={`text-[14px] ${row.highlight ? "font-medium text-white" : "text-white/45"}`}>
                          {row.name}
                        </span>
                        <span
                          className={`text-[15px] tracking-[-0.01em] tabular-nums ${
                            row.highlight ? "font-semibold text-[#00C8A8]" : "text-white/45"
                          }`}
                        >
                          {eur.format(row.cost)}
                          <span className="ml-1.5 text-[11px] font-normal text-white/25">{row.pct.toFixed(1)}%</span>
                        </span>
                      </div>
                      <div className="h-[7px] overflow-hidden rounded-full bg-white/5">
                        <div
                          className={`h-full rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                            row.highlight ? "bg-[#00C8A8]" : "bg-white/18"
                          }`}
                          style={{ width: `${Math.max((row.cost / maxCost) * 100, 1.5)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-10 border-t border-border pt-7">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <CountUpEuro
                    value={saved}
                    className="font-(family-name:--font-cormorant) text-[38px] leading-none font-bold tracking-[-1px] text-white tabular-nums sm:text-[46px]"
                  />
                  <span className="text-[14px] text-white/45">
                    saved on commissions every year, compared with Booking.com.
                  </span>
                </div>
                <p className="mt-3 text-[13px] text-white/30">
                  That&apos;s about <span className="text-[#00C8A8] tabular-nums">{freeNights.toLocaleString("en-IE")}</span>{" "}
                  {freeNights === 1 ? "night" : "nights"} of revenue at your own rate.
                </p>
              </div>
            </div>
          </div>
        </Card>

        <p className="mx-auto mt-5 max-w-[75ch] text-center text-[11px] leading-[1.7] text-white/22">
          Competitor figures are typical published commission rates and vary by market and agreement.
          OpenBookings cost includes Stripe processing (1.5% + €0.25 per booking, standard EEA cards),
          passed through with no markup.
        </p>
      </div>
    </section>
  );
}
