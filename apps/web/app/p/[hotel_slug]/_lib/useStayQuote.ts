"use client";

import { useEffect, useState } from "react";
import type { StayQuote } from "@/lib/booking/quote";
import type { QuoteState } from "./merge-quote";
import { stayToParams, type Stay } from "./stay";

/**
 * Prices and availability for the stay in the URL, from /api/stay-quote. A new
 * stay cancels the request for the old one, so prices for other dates never
 * land. Bump `reload` to ask again for the same stay (after a room was just
 * booked, say).
 */
export function useStayQuote(slug: string, stay: Stay | null, reload = 0): QuoteState {
  const query = stay
    ? `property=${encodeURIComponent(slug)}&${stayToParams(stay).toString()}`
    : null;
  // The state is keyed to the request it answers; an answer for another query
  // reads as loading until its own arrives.
  const [result, setResult] = useState<{ key: string; state: QuoteState } | null>(null);
  const key = query ? `${query}#${reload}` : null;

  useEffect(() => {
    if (!query || !key) return;
    const controller = new AbortController();
    fetch(`/api/stay-quote?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`stay-quote ${res.status}`);
        const quote = (await res.json()) as StayQuote;
        setResult({ key, state: { status: "ready", quote } });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResult({ key, state: { status: "error" } });
      });
    return () => controller.abort();
  }, [query, key]);

  if (!key) return { status: "none" };
  if (result?.key !== key) return { status: "loading" };
  return result.state;
}
