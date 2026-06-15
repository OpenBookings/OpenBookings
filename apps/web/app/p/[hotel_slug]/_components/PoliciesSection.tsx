import {
  LogIn, LogOut, Clock, XCircle, CreditCard, Baby, BedDouble, AlertCircle, Dog,
} from "lucide-react";
import type { HotelPageData } from "@/app/api/query/pr/route";
import { BusinessDetailsButton } from "./BusinessDetailsButton";

export function PoliciesSection({ hotel }: { hotel: HotelPageData }) {
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
              {[
                { Icon: LogIn,  title: "Check-in",  body: "From 15:00 — Early check-in subject to availability" },
                { Icon: LogOut, title: "Check-out", body: "Until 12:00 — Late check-out available on request" },
                { Icon: Clock,  title: "Reception", body: "24-hour front desk — no check-in cut-off" },
              ].map(({ Icon, title, body }) => (
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
              {[
                {
                  Icon: XCircle,
                  title: "Free Cancellation",
                  body: "Cancel up to 7 days before arrival at no charge. Cancellations within 7 days incur the first night's charge.",
                },
                {
                  Icon: CreditCard,
                  title: "Prepayment",
                  body: "Required to secure your booking. Full authorization needed before arrival.",
                },
              ].map(({ Icon, title, body }) => (
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
              {[
                { Icon: Baby,      text: "Children of all ages welcome" },
                { Icon: BedDouble, text: "Cots available on request — free of charge" },
                { Icon: BedDouble, text: "Extra beds available — €60 per night" },
              ].map(({ Icon, text }) => (
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
              {[
                { src: "https://cdn.openbookings.co/media/visa.png",        alt: "Visa" },
                { src: "https://cdn.openbookings.co/media/mastercard.png",  alt: "Mastercard" },
                { src: "https://cdn.openbookings.co/media/amex.svg",        alt: "American Express" },
                { src: "https://cdn.openbookings.co/media/wero-1.svg",      alt: "Wero" },
                { src: "https://cdn.openbookings.co/media/applepay.svg",    alt: "Apple Pay" },
              ].map(({ src, alt }) => (
                <div key={alt} className="flex items-center justify-center h-9 w-16 rounded-lg bg-white/6 border border-white/10">
                  <img src={src} alt={alt} className="h-5 w-10 object-contain" draggable={false} />
                </div>
              ))}
              <div className="group relative flex items-center justify-center h-9 w-16 rounded-lg bg-white/6 border border-white/10" style={{ cursor: "help" }}>
                <span className="text-xs font-medium text-white/55 tracking-wide border-b border-dashed border-white/30">
                  Cash
                </span>
                <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[180px] rounded-lg bg-[#1a1a1a] border border-white/12 px-3 py-2 text-xs text-white/70 leading-snug opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 text-center">
                  Payment method only available at the hotel
                </div>
              </div>
            </div>
          </div>

          {/* Other */}
          <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-5">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30">Other</p>
            <div className="flex flex-col gap-3">
              {[
                { Icon: AlertCircle, text: "Minimum check-in age: 18 years" },
                { Icon: Dog,         text: "Pets not allowed" },
              ].map(({ Icon, text }) => (
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
          <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-5">The Not-So-Small Print</p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-2.5 text-sm text-white/60 leading-relaxed">
            {[
              "A security deposit of €500 is required upon arrival and will be fully refunded within 7 days of check-out, subject to room inspection.",
              "Government-issued photo ID and a valid credit card are required at check-in. Guests must be at least 18 years old.",
              "Quiet hours are observed between 22:00 and 08:00. Events and gatherings require prior written approval from management.",
              "The property reserves the right to pre-authorise the provided credit card prior to arrival. Rates displayed are inclusive of applicable taxes and service charges.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-1.5 size-1 rounded-full bg-white/25 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="border-t border-white/6 mt-6 pt-6">
            <p className="text-xs uppercase tracking-[0.18em] text-white/30 mb-3">Legal information</p>
            <p className="text-sm text-white/60 leading-relaxed">
              OpenBookings acts as Online Travel Agent and payment intermediary on behalf of{" "}
              {hotel.name}.
              <br />
              Your reservation is a direct contract with {hotel.name}.{" "}
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
