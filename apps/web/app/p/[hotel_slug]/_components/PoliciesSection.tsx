import { cdnImageUrl } from "@openbookings/images";
import {
  LogIn, LogOut, Clock, XCircle, CreditCard, Baby, BedDouble, AlertCircle, Dog, Info,
} from "lucide-react";
import { TIER_LABELS, TIER_SUMMARIES } from "@openbookings/pricing";
import type { HotelPageData } from "@/app/api/query/pr/route";
import { BusinessDetailsButton } from "./BusinessDetailsButton";

export function PoliciesSection({
  hotel,
  hasNonRefundable,
  extras,
}: {
  hotel: HotelPageData;
  /** Some rates on the page are Non-refundable. */
  hasNonRefundable: boolean;
  /** Whether any room offers cots, or extra beds. Each room sets its own. */
  extras: { cots: boolean; extraBeds: boolean };
}) {
  const extrasOffered = [extras.cots && "cots", extras.extraBeds && "extra beds"].filter(Boolean).join(" and ");
  // Formatting lives here rather than in the editor so every property phrases
  // these the same way, and so the wording survives a future translation pass.
  const arrival = [
    {
      Icon: LogIn,
      title: "Check-in",
      body: `From ${hotel.check_in_time}${hotel.check_in_until ? ` until ${hotel.check_in_until}` : ""}`,
    },
    { Icon: LogOut, title: "Check-out", body: `Until ${hotel.check_out_time}` },
    ...(hotel.reception_24h
      ? [{ Icon: Clock, title: "Reception", body: "24-hour front desk — no check-in cut-off" }]
      : []),
  ];

  // Entries cached before 0027 have no tier; Standard is what 0027 defaults to.
  const tier = hotel.cancellation_tier ?? "standard";
  const cancellation = [
    {
      Icon: XCircle,
      title: `Cancellation · ${TIER_LABELS[tier]}`,
      body: `${TIER_SUMMARIES[tier]} If you don't show up, nothing is refunded. Exact dates are shown at checkout.`,
    },
    ...(hasNonRefundable
      ? [{ Icon: XCircle, title: "Non-refundable rates", body: "Some rates are non-refundable and cheaper." }]
      : []),
    ...(hotel.prepayment_required
      ? [
          {
            Icon: CreditCard,
            title: "Prepayment",
            body: extrasOffered
              ? `Required to secure your booking. ${extrasOffered[0].toUpperCase()}${extrasOffered.slice(1)} are paid at the hotel.`
              : "Required to secure your booking.",
          },
        ]
      : []),
  ];

  // Age bands are the same at every hotel (guest-limits AGE_BANDS); prices
  // for cots and extra beds differ per room, so they stay on the room card.
  const childrenWelcome = hotel.children_welcome ?? true;
  const childrenAndBeds = [
    { Icon: Baby, text: childrenWelcome ? "Children of all ages welcome" : "Adults only" },
    ...(childrenWelcome
      ? [
          {
            Icon: Info,
            text: "Adults are 13 or over, children 2–12, infants under 2. Infants stay free and don't take a place in the room.",
          },
        ]
      : []),
    ...(extrasOffered
      ? [
          {
            Icon: BedDouble,
            text: `Some rooms have ${extrasOffered}. Add them when you book; you pay for them at the hotel.`,
          },
        ]
      : []),
  ];

  const other = [
    ...(hotel.min_check_in_age !== null
      ? [{ Icon: AlertCircle, text: `Minimum check-in age: ${hotel.min_check_in_age} years` }]
      : []),
    { Icon: Dog, text: hotel.pets_allowed ? "Pets allowed" : "Pets not allowed" },
  ];

  // Artwork, names and tooltips come from the `payment_methods` catalogue via
  // the query — the page no longer knows which methods exist. Already ordered.
  const paymentMethods = hotel.payment_methods ?? [];

  const finePrint = hotel.fine_print ?? [];

  return (
    <section id="policies" className="bg-[#0a0a0a] border-t border-white/6 py-28 sm:py-36">
      <div className="px-4 sm:px-8 md:px-16 max-w-7xl mx-auto">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-6 text-center">Policies</p>
        <h2 className="font-serif text-4xl sm:text-5xl mb-16 text-center">House Rules</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          {/* Check-in / Check-out */}
          <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30">Arrival &amp; Departure</p>
            <div className="flex flex-col gap-4">
              {arrival.map(({ Icon, title, body }) => (
                <div key={title} className="flex items-center gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/8 text-white/40">
                    <Icon className="size-4" strokeWidth={1.6} />
                  </span>
                  <div>
                    <p className="text-sm text-white/80 font-medium mb-0.5">{title}</p>
                    <p className="text-sm text-white/65">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cancellation & Prepayment */}
          <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30">Cancellation &amp; Prepayment</p>
            <div className="flex flex-col gap-4">
              {cancellation.map(({ Icon, title, body }) => (
                <div key={title} className="flex items-center gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/8 text-white/40">
                    <Icon className="size-4" strokeWidth={1.6} />
                  </span>
                  <div>
                    <p className="text-sm text-white/80 font-medium mb-0.5">{title}</p>
                    <p className="text-sm text-white/65">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-12">
          {/* Children & Beds */}
          <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30">Children &amp; Beds</p>
            <div className="flex flex-col gap-3">
              {childrenAndBeds.map(({ Icon, text }) => (
                <div key={text} className="flex items-center gap-3">
                  <Icon className="size-4 shrink-0 text-white/35" strokeWidth={1.6} />
                  <p className="text-sm text-white/65">{text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Payment Methods */}
          <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30">Payment Methods</p>
            <div className="flex flex-wrap gap-3">
              {paymentMethods.map(({ code, label, artwork_url, note }) => (
                <div
                  key={code}
                  className="group relative flex items-center justify-center h-9 w-16 rounded-lg bg-white/6 border border-white/10"
                  style={note ? { cursor: "help" } : undefined}
                >
                  {artwork_url ? (
                    <img src={cdnImageUrl(artwork_url, { width: 96 })} alt={label} className="h-5 w-10 object-contain" draggable={false} loading="lazy" decoding="async" />
                  ) : (
                    // No logo in the catalogue — the name is the tile.
                    <span className={`text-xs font-medium text-white/55 tracking-wide${note ? " border-b border-dashed border-white/30" : ""}`}>
                      {label}
                    </span>
                  )}
                  {note && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-45 rounded-lg bg-[#1a1a1a] border border-white/12 px-3 py-2 text-xs text-white/70 leading-snug opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 text-center">
                      {note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Other */}
          <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30">Other</p>
            <div className="flex flex-col gap-3">
              {other.map(({ Icon, text }) => (
                <div key={text} className="flex items-center gap-3">
                  <Icon className="size-4 shrink-0 text-white/35" strokeWidth={1.6} />
                  <p className="text-sm text-white/65">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Fine Print */}
        <div className="rounded-2xl border border-white/8 bg-white/2 p-7">
          {/* Only the list is conditional. The legal disclosure below it is not
              optional content — it must show even for a property whose host has
              not written any fine print yet. */}
          {finePrint.length > 0 && (
            <>
              <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-5">The Not-So-Small Print</p>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-2.5 text-sm text-white/60 leading-relaxed">
                {finePrint.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-1.5 size-1 rounded-full bg-white/25 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={finePrint.length > 0 ? "border-t border-white/6 mt-6 pt-6" : ""}>
            <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-3">Legal information</p>
            <p className="text-sm text-white/60 leading-relaxed">
              OpenBookings acts as Online Travel Agent and payment intermediary on behalf of{" "}
              {hotel.legal_company_name ?? hotel.name}.
              <br />
              Your reservation is a direct contract with {hotel.legal_company_name ?? hotel.name}.{" "}
              <BusinessDetailsButton hotel={hotel} />
            </p>
          </div>

          <div className="border-t border-white/6 mt-6 pt-5">
            <a
              href="https://openbookings.co"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-white/45 hover:text-white/70 transition-colors underline underline-offset-3 decoration-white/20 hover:decoration-white/45"
            >
              Cancellation policy →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
