"use client";

import { Suspense, useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  finishNavigation,
  getNavigationProgress,
  getServerNavigationProgress,
  subscribeNavigationProgress,
} from "@/lib/navigation-progress";

/** Ends the bar once the new URL has rendered (or its loading.tsx has). */
function FinishOnUrlChange() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    finishNavigation();
  }, [pathname, searchParams]);
  return null;
}

/**
 * A thin bar along the top of the window while a page loads, in place of the
 * browser's own loading indicator, which client-side navigations never trigger.
 * Started by onRouterTransitionStart in instrumentation-client.ts.
 */
export function NavigationProgress() {
  const { visible, progress } = useSyncExternalStore(
    subscribeNavigationProgress,
    getNavigationProgress,
    getServerNavigationProgress,
  );

  return (
    <>
      <Suspense fallback={null}>
        <FinishOnUrlChange />
      </Suspense>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647] h-[2px] origin-left bg-white shadow-[0_0_8px_rgb(255_255_255/0.6)]"
        style={{
          transform: `scaleX(${progress})`,
          opacity: visible ? 1 : 0,
          // No transform transition while hidden, so a reset never shows.
          transition: visible ? "transform 200ms ease-out, opacity 150ms ease-out" : "opacity 250ms ease-out",
        }}
      />
    </>
  );
}
