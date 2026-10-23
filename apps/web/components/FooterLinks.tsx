"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useCookieConsent } from "@openbookings/analytics/client";
import FocusOverlay from "@/components/plug-in/FocusOverlay";

// Inlined at build time, so a non-production web build links at the matching
// business deployment rather than sending the visitor to production.
const BUSINESS_URL =
  process.env.NEXT_PUBLIC_BUSINESS_URL || "https://business.openbookings.co/";

const lineLink = "hover:text-white transition-colors";
const panelLink = "text-sm text-white/65 hover:text-white transition-colors";
const panelHeading = "text-[11px] uppercase tracking-widest text-white/35 font-medium mb-1";

interface FooterLinksProps {
  /** Shown bottom-right as a credit for the full-screen backdrop. */
  photoName?: string;
}

/**
 * The glass pages' stand-in for a footer: one quiet line along the bottom edge.
 * The chevron slides right to uncover the links and back to hide them; "More"
 * opens the full panel.
 */
export function FooterLinks({ photoName }: FooterLinksProps) {
  const [linksOpen, setLinksOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const { reopen: reopenCookieBanner } = useCookieConsent();

  return (
    <>
      <div
        className="fixed bottom-0 inset-x-0 z-20 px-4 sm:px-6 md:px-8 pt-10 pb-3 sm:pb-4 flex flex-wrap items-center justify-center sm:justify-between gap-x-6 gap-y-1 text-[11px] sm:text-xs text-white/75 select-none pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0) 100%)",
          textShadow: "0 1px 4px rgba(0,0,0,0.6)",
        }}
      >
        <nav aria-label="Footer" className="flex items-center">
          <span>© {new Date().getFullYear()} OpenBookings</span>
          {/* The links sit in a 0fr -> 1fr grid column, so as it widens the
              chevron after it is pushed right and the links are uncovered. */}
          <div
            id="footer-links"
            inert={!linksOpen}
            className={`grid transition-[grid-template-columns] duration-500 ease-in-out motion-reduce:transition-none ${linksOpen ? "grid-cols-[1fr]" : "grid-cols-[0fr]"}`}
          >
            <div className="overflow-hidden">
              <div
                className={`flex items-center gap-x-3 pl-3 py-0.5 whitespace-nowrap transition-opacity duration-500 ease-in-out motion-reduce:transition-none ${linksOpen ? "opacity-100" : "opacity-0"}`}
              >
                <Link href="/legal/en/privacy" className={lineLink}>Privacy</Link>
                <a href="/terms" className={lineLink}>Terms</a>
                <button type="button" onClick={reopenCookieBanner} className={lineLink}>Cookies</button>
                <a href="/support" className={lineLink}>Support</a>
                <button type="button" onClick={() => setPanelOpen(true)} className={lineLink}>More</button>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLinksOpen((open) => !open)}
            aria-expanded={linksOpen}
            aria-controls="footer-links"
            aria-label={linksOpen ? "Hide links" : "Show links"}
            className={`ml-1.5 -my-1 p-1 rounded-full ${lineLink}`}
          >
            <ChevronRight
              aria-hidden
              className={`size-3.5 transition-transform duration-500 ease-in-out motion-reduce:transition-none ${linksOpen ? "rotate-180" : ""}`}
            />
          </button>
        </nav>
        {photoName && <span className="hidden sm:inline text-white/55">Photo: {photoName}</span>}
      </div>

      <FocusOverlay open={panelOpen} onClose={() => setPanelOpen(false)}>
        <div className="rounded-2xl border border-white/12 bg-black/85 backdrop-blur-xl shadow-2xl overflow-hidden w-full max-w-xl mx-auto">
          <div className="flex items-center justify-between px-6 pt-6 pb-5">
            <div>
              <p className="text-white font-serif text-xl font-semibold tracking-tight">OpenBookings</p>
              <p className="text-white/40 text-xs mt-0.5">Quick, Easy &amp; Open-Source</p>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="h-8 w-8 shrink-0 rounded-full border border-white/15 bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors text-sm"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="px-6 pb-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-6">
            <div className="flex flex-col gap-2">
              <p className={panelHeading}>Contact</p>
              <a href="/support" className={panelLink}>Booking Support</a>
              <a href="/press" className={panelLink}>Press & Media</a>
              <Link href="/legal" className={panelLink}>Legal Questions</Link>
              <a href="/suggestions" className={panelLink}>Suggestions</a>
            </div>
            <div className="flex flex-col gap-2">
              <p className={panelHeading}>Legal</p>
              <Link href="/legal/en/privacy" className={panelLink}>Privacy Notice</Link>
              <a href="/terms" className={panelLink}>Terms of Service</a>
              <a href="/disputes" className={panelLink}>Dispute Resolution</a>
              <button
                type="button"
                onClick={() => {
                  reopenCookieBanner();
                  setPanelOpen(false);
                }}
                className={`${panelLink} text-left`}
              >
                Cookie Settings
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <p className={panelHeading}>Company</p>
              <a href="/company" className={panelLink}>Company Info</a>
              <a href={BUSINESS_URL} className={panelLink}>List your property</a>
            </div>
          </div>
        </div>
      </FocusOverlay>
    </>
  );
}
