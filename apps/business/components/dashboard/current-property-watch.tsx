"use client";

import { useEffect, useState } from "react";
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
 * Checks only when the tab regains focus or becomes visible, never on a timer.
 */
export function CurrentPropertyWatch({
  renderedPropertyId,
  hotelName: _hotelName,
}: {
  renderedPropertyId: string | null;
  hotelName: string;
}) {
  const [switched, setSwitched] = useState<string | null>(null);

  useEffect(() => {
    if (!renderedPropertyId) return;
    let cancelled = false;
    const check = async () => {
      const found = await checkForSwitchedHotel(renderedPropertyId);
      if (!cancelled) setSwitched(found ? found.hotelName : null);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [renderedPropertyId]);

  if (!switched) return null;
  return <StaleHotelNotice hotelName={switched} onReload={() => window.location.reload()} />;
}
