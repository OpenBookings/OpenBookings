"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Asks the server which hotel is current now. Returns the new hotel's name
 * when it differs from the one this tab rendered, otherwise null. Errors,
 * unauthorized replies and a tab with no rendered hotel all stay quiet.
 */
export async function checkForSwitchedHotel(
  renderedPropertyId: string | null,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<{ hotelName: string } | null> {
  if (!renderedPropertyId) return null;
  try {
    const res = await fetcher("/api/current-property", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { propertyId?: string | null; propertyName?: string | null };
    if (!body.propertyId || body.propertyId === renderedPropertyId) return null;
    return { hotelName: body.propertyName || "another hotel" };
  } catch {
    return null;
  }
}

/** What made the tab check: it regained focus or visibility, or it navigated client-side. */
export type CheckTrigger = "focus" | "navigation";

/**
 * How a tab reacts to finding the session on another hotel. Found on focus,
 * the switch happened in another tab: say so and let the user reload. Found
 * right after a client-side navigation, this tab did it (a link that switched
 * the hotel on the server while Next kept the old layout): re-render the
 * layout on the new hotel, without the "another tab" copy.
 */
export function reactionToSwitch(trigger: CheckTrigger): "notice" | "refresh" {
  return trigger === "navigation" ? "refresh" : "notice";
}

export function StaleHotelNotice({ hotelName, onReload }: { hotelName: string; onReload: () => void }) {
  return (
    <div
      role="status"
      className="flex w-full items-center justify-between gap-3 border-b bg-muted px-4 py-2 text-sm text-foreground"
    >
      <span>You switched to {hotelName} in another tab.</span>
      <Button size="sm" variant="outline" onClick={onReload}>
        Reload
      </Button>
    </div>
  );
}

/**
 * Tells a tab left open on hotel A that the session now points at hotel B.
 * Checks when the tab regains focus or becomes visible (switched in another
 * tab: notice), and after each client-side navigation (switched by a link in
 * this tab: refresh the layout). Never on a timer.
 */
export function CurrentPropertyWatch({ renderedPropertyId }: { renderedPropertyId: string | null }) {
  const [switched, setSwitched] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const lastPathname = useRef(pathname);

  useEffect(() => {
    if (!renderedPropertyId) return;
    let cancelled = false;
    const check = async (trigger: CheckTrigger) => {
      const found = await checkForSwitchedHotel(renderedPropertyId);
      if (cancelled) return;
      if (found && reactionToSwitch(trigger) === "refresh") {
        setSwitched(null);
        router.refresh();
      } else if (found || trigger === "focus") {
        setSwitched(found ? found.hotelName : null);
      }
    };
    const onFocus = () => void check("focus");
    const onVisible = () => {
      if (document.visibilityState === "visible") void check("focus");
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    // A client-side navigation keeps this layout. When the server changed the
    // current hotel on the way (a ?property= link the proxy handled), the
    // sidebar is stale now. Not on mount: the layout just rendered.
    if (lastPathname.current !== pathname) {
      lastPathname.current = pathname;
      void check("navigation");
    }
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [renderedPropertyId, pathname, router]);

  if (!switched) return null;
  return <StaleHotelNotice hotelName={switched} onReload={() => window.location.reload()} />;
}
