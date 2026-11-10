"use client";

import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ObGlobe } from "@/components/dashboard/ob-globe";
import { GRACE_MS, LINE_MS, lineIndex, loaderClock } from "@/lib/analytics/loader-timing";
import { PAGES, type PageId } from "@/lib/analytics/pages";

/** What each page is working out, in the order the page shows it. The last line stays. */
const LINES: Record<PageId, readonly string[]> = {
  revenue: [
    "Adding up what you earned",
    "Setting aside the 4.5% commission",
    "Working out ADR and RevPAR",
    "Drawing revenue over time",
  ],
  occupancy: [
    "Counting the nights you sold",
    "Finding the nights still unsold",
    "Looking ahead 90 days",
    "Sorting occupancy by weekday",
  ],
  "booking-patterns": [
    "Looking at when guests book",
    "Measuring how long they stay",
    "Counting cancellations",
    "Grouping by rate plan",
  ],
  pricing: [
    "Lining up your rates",
    "Working out your ADR",
    "Adding up discounts given",
    "Comparing weekdays",
  ],
  guests: [
    "Getting to know your guests",
    "Counting returning guests",
    "Finding where bookers come from",
    "Grouping by party size",
  ],
};

/** How long a line takes to slide out (globals.css `.ob-loader-line`). */
const LINE_OUT_MS = 450;

interface AnalyticsLoaderProps {
  page: PageId;
  /** A first line before the page's own, e.g. "Switching to last 3 months". */
  lead?: string | null;
  /** The loader in loading.tsx: it starts the shared clock, or picks it up from the loader it replaced. */
  track?: boolean;
  /** A loader holding on after its load: when that load started, so it carries on mid-animation. */
  startedAt?: number;
}

/**
 * The logo with its stripes lighting up in turn, a hairline with a glint, and
 * a line saying what is being worked out. It fades in only after the grace
 * period (globals.css), so a fast load never shows it.
 */
export function AnalyticsLoader({ page, lead = null, track = false, startedAt }: AnalyticsLoaderProps) {
  const lines = lead ? [lead, ...LINES[page]] : LINES[page];
  const count = lines.length;
  const root = useRef<HTMLDivElement>(null);
  // A loader holding on after its load picks up at the line it had reached.
  const [line, setLine] = useState<{ current: number; leaving: number | null }>(() => ({
    current: startedAt === undefined ? 0 : lineIndex(performance.now() - startedAt, count),
    leaving: null,
  }));

  // A layout effect, because its cleanup has to run before the page content's
  // layout effect in the same commit, or the content would miss the handover.
  useLayoutEffect(() => {
    const now = performance.now();
    let since = startedAt ?? now;
    let lineBase = since;
    if (track) {
      since = loaderClock.begin(now);
      // Taking over from another page's loader: already visible, but this page's lines start from the top.
      lineBase = since === now ? now : now - GRACE_MS;
    }
    // Written to the element, not React state: the animations read it to carry on where they were.
    root.current?.style.setProperty("--ob-elapsed", `${Math.round(now - since)}ms`);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const elapsed = performance.now() - lineBase;
      const current = lineIndex(elapsed, count);
      if (current >= count - 1) return;
      timer = setTimeout(() => {
        const next = lineIndex(performance.now() - lineBase, count);
        setLine((previous) => (previous.current === next ? previous : { current: next, leaving: previous.current }));
        schedule();
      }, Math.max(0, GRACE_MS + (current + 1) * LINE_MS - elapsed));
    };
    schedule();

    return () => {
      clearTimeout(timer);
      if (track) loaderClock.end(performance.now());
    };
  }, [track, startedAt, count]);

  useEffect(() => {
    if (line.leaving === null) return;
    const timer = setTimeout(() => setLine((previous) => ({ ...previous, leaving: null })), LINE_OUT_MS);
    return () => clearTimeout(timer);
  }, [line.leaving]);

  return (
    <div
      ref={root}
      role="status"
      className="ob-loader flex flex-col items-center gap-3.5 text-center"
      style={{ "--ob-grace": `${GRACE_MS}ms` } as CSSProperties}
    >
      <span className="sr-only">Loading {PAGES[page].title}</span>
      <ObGlobe animated className="h-14 w-auto" />
      <div className="ob-loader-track h-px w-32 rounded-full bg-border" aria-hidden />
      <div className="relative h-5 w-72 max-w-[calc(100vw-2rem)] overflow-hidden text-muted-foreground text-sm" aria-hidden>
        {line.leaving !== null ? (
          <span key={`leaving-${line.leaving}`} data-leaving="" className="ob-loader-line absolute inset-0">
            {lines[line.leaving]}…
          </span>
        ) : null}
        <span key={line.current} className="ob-loader-line absolute inset-0">
          {lines[line.current]}…
        </span>
      </div>
    </div>
  );
}

/** Where the loader sits: centred, a little way down the empty content area. */
export function LoaderStage({ children }: { children: ReactNode }) {
  return <div className="flex justify-center px-4 pt-16 md:pt-24 lg:px-6">{children}</div>;
}
