"use client";

import { useState } from "react";
import { X } from "lucide-react";
import FocusOverlay from "@/components/plug-in/FocusOverlay";
import type { HotelPageData } from "@/app/api/query/pr/route";

export function BusinessDetailsButton({ hotel }: { hotel: HotelPageData }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-white/45 hover:text-white/70 transition-colors underline underline-offset-3 decoration-white/20 hover:decoration-white/45"
      >
        View business details →
      </button>

      <FocusOverlay open={open} onClose={() => setOpen(false)}>
        <div className="bg-[#111] border border-white/10 rounded-2xl p-8 max-h-[80vh] overflow-y-auto [&::-webkit-scrollbar]:w-px [&::-webkit-scrollbar-thumb]:bg-white/10]">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Business Details</p>
              <h2 className="font-serif text-3xl sm:text-4xl text-white leading-tight">{hotel.name}</h2>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="size-9 flex items-center justify-center rounded-full bg-white/6 border border-white/10 text-white/40 hover:text-white/70 transition-colors shrink-0 mt-1"
            >
              <X className="size-4" strokeWidth={1.8} />
            </button>
          </div>

          <p className="text-sm text-white/60 leading-relaxed mb-8 border-b border-white/8 pb-8">
            OpenBookings acts as Online Travel Agent and payment intermediary on behalf of this
            property. Your reservation is a direct contract with the property operator listed below.
            The operator is responsible for the delivery of services described on this listing and is
            registered with the relevant local trade authority.
          </p>

          <div className="relative group mb-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 transition-[filter] duration-300 group-hover:blur-none blur-sm select-none group-hover:select-auto">
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">Legal name</p>
                <p className="text-sm text-white/80 font-medium">{hotel.name}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">Address</p>
                <p className="text-sm text-white/80">Via della Quiete 1</p>
                <p className="text-sm text-white/80">57037 Portoferraio, Italy</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">Email</p>
                <p className="text-sm text-white/80">
                  reservations@{hotel.name.toLowerCase().replace(/\s+/g, "")}.com
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">Phone</p>
                <p className="text-sm text-white/80">+39 0565 944 111</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">Company registration</p>
                <p className="text-sm text-white/80 font-mono tracking-wide">IT 03847210491</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.15em] text-white/30 mb-2">VAT number</p>
                <p className="text-sm text-white/80 font-mono tracking-wide">REA LI-92847</p>
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-300 group-hover:opacity-0">
              <span className="text-xs uppercase tracking-[0.18em] text-white/45">Hover to show</span>
            </div>
          </div>

          <div className="border-t border-white/8 pt-6">
            <p className="text-xs text-white/30 leading-relaxed">
              This information is provided for transparency purposes. OpenBookings verifies operator
              registrations at the time of onboarding. For disputes or complaints, contact us at{" "}
              <span className="text-white/50">support@openbookings.co</span>.
            </p>
          </div>
        </div>
      </FocusOverlay>
    </>
  );
}
