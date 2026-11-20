"use client";

import { type ReactNode, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { holdRemaining, loaderClock } from "@/lib/analytics/loader-timing";
import { LoaderStage, PageLoader } from "./page-loader";

const subscribeNever = () => () => {};

/** The page the content area last showed, to tell a page switch from a re-render of the same page. */
let lastPage: string | null = null;

/**
 * When the loader in front of this content started, while it still has to
 * stay up. That is the route loader this content replaced, or, when the page
 * opened instantly from the router cache, now. A full page load is left alone:
 * its content is already on screen from the server.
 */
export function useRouteHandover(page: string): number | null {
  // False while hydrating server HTML, true when React mounts this on a client navigation.
  const onClient = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const mountedOnClient = useRef(onClient);
  // A ref, so React's development double-run of effects reads the handover once.
  const taken = useRef<number | null | undefined>(undefined);
  const [holding, setHolding] = useState<number | null>(null);

  // Can run again later (React re-runs layout effects when a boundary is
  // re-shown), so every path ends with the hold either running or released.
  useLayoutEffect(() => {
    if (taken.current === undefined) {
      const now = performance.now();
      const pageSwitch = mountedOnClient.current && lastPage !== page;
      taken.current = loaderClock.handover(now) ?? (pageSwitch ? now : null);
      lastPage = page;
    }
    const startedAt = taken.current;
    if (startedAt === null) return;
    const release = () => {
      taken.current = null;
      setHolding(null);
    };
    const remaining = holdRemaining(startedAt, performance.now());
    if (remaining <= 0) {
      release();
      return;
    }
    setHolding(startedAt);
    const timer = setTimeout(release, remaining);
    return () => clearTimeout(timer);
  }, [page]);

  return holding;
}

interface LoaderHoldProps {
  /** Which page this is, e.g. "finance/billing". */
  page: string;
  label: string;
  lines: readonly string[];
  children: ReactNode;
}

/**
 * Page content arriving from its loading.tsx: it waits under the loader until
 * the loader has been up for a full second, then fades in. Analytics has its
 * own version (AnalyticsBody) that also dims the figures on a period change.
 */
export function LoaderHold({ page, label, lines, children }: LoaderHoldProps) {
  const from = useRouteHandover(page);
  return (
    <div className="relative flex min-w-0 flex-col" aria-busy={from !== null}>
      <div
        className="ob-loader-dim flex min-w-0 flex-col gap-4 md:gap-6"
        data-hidden={from !== null ? "" : undefined}
        inert={from !== null}
      >
        {children}
      </div>
      {from !== null ? (
        <div className="pointer-events-none absolute inset-x-0 top-0">
          <LoaderStage>
            <PageLoader key={from} label={label} lines={lines} startedAt={from} />
          </LoaderStage>
        </div>
      ) : null}
    </div>
  );
}
