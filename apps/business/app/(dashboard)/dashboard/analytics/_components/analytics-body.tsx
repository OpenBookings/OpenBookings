"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useRouteHandover } from "@/components/dashboard/loader-hold";
import { holdRemaining } from "@/lib/analytics/loader-timing";
import type { PageId } from "@/lib/analytics/pages";
import { AnalyticsLoader, LoaderStage } from "./analytics-loader";
import { useAnalyticsPending } from "./analytics-pending";

/**
 * The content under the page header, and the two ways the loader stays on it:
 *
 * - Arriving on a tab, from loading.tsx or straight from the router cache: the
 *   figures wait under the loader until it has been up for a full second, then
 *   fade in.
 * - A period change: the old figures dim and blur under the loader while the
 *   new ones load, and for the rest of the second after they arrive.
 */
export function AnalyticsBody({ page, children }: { page: PageId; children: ReactNode }) {
  const handoverFrom = useRouteHandover(page);
  const { pending, lead } = useAnalyticsPending();
  const periodFrom = useHeldWhile(pending);

  const loaderFrom = handoverFrom ?? periodFrom;
  return (
    <div className="relative flex min-w-0 flex-col" aria-busy={loaderFrom !== null}>
      <div
        className="ob-loader-dim flex min-w-0 flex-col gap-4 md:gap-6"
        data-hidden={handoverFrom !== null ? "" : undefined}
        data-dimmed={handoverFrom === null && periodFrom !== null ? "" : undefined}
        inert={loaderFrom !== null}
      >
        {children}
      </div>
      {loaderFrom !== null ? (
        <div className="pointer-events-none absolute inset-x-0 top-0">
          <LoaderStage>
            <AnalyticsLoader
              key={loaderFrom}
              page={page}
              lead={handoverFrom === null ? lead : null}
              startedAt={loaderFrom}
            />
          </LoaderStage>
        </div>
      ) : null}
    </div>
  );
}

/** When `active` turned on, for as long as it stays on and the rest of the hold after. Null otherwise. */
function useHeldWhile(active: boolean): number | null {
  const startedAt = useRef<number | null>(null);
  const [held, setHeld] = useState<number | null>(null);

  useEffect(() => {
    if (active) {
      startedAt.current ??= performance.now();
      setHeld(startedAt.current);
      return;
    }
    const began = startedAt.current;
    if (began === null) return;
    const release = () => {
      startedAt.current = null;
      setHeld(null);
    };
    const remaining = holdRemaining(began, performance.now());
    if (remaining <= 0) {
      release();
      return;
    }
    const timer = setTimeout(release, remaining);
    return () => clearTimeout(timer);
  }, [active]);

  return held;
}
