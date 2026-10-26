"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

const lineLink = "hover:text-white transition-colors";

// How long the links stay visible after load before sliding shut.
const AUTO_CLOSE_DELAY_MS = 1500;

interface FooterLinksProps {
  /** Shown bottom-right as a credit for the full-screen backdrop. */
  photoName?: string;
}

/**
 * The glass pages' stand-in for a footer: one quiet line along the bottom edge.
 * It loads with the links shown, then slides them shut so visitors see they are
 * there; the chevron toggles them after that.
 */
export function FooterLinks({ photoName }: FooterLinksProps) {
  const [linksOpen, setLinksOpen] = useState(true);
  const autoClose = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    autoClose.current = setTimeout(() => setLinksOpen(false), AUTO_CLOSE_DELAY_MS);
    return () => {
      if (autoClose.current) clearTimeout(autoClose.current);
    };
  }, []);

  const toggleLinks = () => {
    // A click before the auto-close wins; don't close the links under the visitor.
    if (autoClose.current) clearTimeout(autoClose.current);
    autoClose.current = null;
    setLinksOpen((open) => !open);
  };

  return (
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
              <a href="/support" className={lineLink}>Support</a>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleLinks}
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
  );
}
