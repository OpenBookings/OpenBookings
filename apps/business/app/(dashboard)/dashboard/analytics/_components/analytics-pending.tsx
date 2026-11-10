"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState, useTransition } from "react";

interface AnalyticsPending {
  /** A period or comparison change is on its way. */
  pending: boolean;
  /** The first line the loader shows for it, e.g. "Switching to last 3 months". */
  lead: string | null;
  /** Runs a navigation as a transition: the old figures stay up, dimmed, until the new ones arrive. */
  run: (lead: string, navigate: () => void) => void;
}

const PendingContext = createContext<AnalyticsPending | null>(null);

/**
 * A period change navigates to the same page with new search params, so the
 * route loader never shows. The period control starts the transition here
 * instead, and the content area reads it to dim the old figures and show the
 * loader over them.
 */
export function AnalyticsPendingProvider({ children }: { children: ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [lead, setLead] = useState<string | null>(null);
  const run = useCallback((next: string, navigate: () => void) => {
    setLead(next);
    startTransition(navigate);
  }, []);
  const value = useMemo(() => ({ pending, lead, run }), [pending, lead, run]);
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}

const OUTSIDE: AnalyticsPending = { pending: false, lead: null, run: (_lead, navigate) => navigate() };

export function useAnalyticsPending(): AnalyticsPending {
  return useContext(PendingContext) ?? OUTSIDE;
}
