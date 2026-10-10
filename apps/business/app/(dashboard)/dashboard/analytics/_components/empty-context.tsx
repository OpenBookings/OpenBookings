"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { EmptyVariant } from "@/lib/analytics/empty-state";

interface EmptyValue {
  variant: EmptyVariant;
  /** A message shown above the widgets. Absent when the page is covered instead. */
  panel?: ReactNode;
}

const EmptyContext = createContext<EmptyValue | null>(null);

/**
 * Tells the stat row and the widget grid that the page has nothing to show and
 * why, so every view keeps its real layout without knowing about empty states.
 */
export function EmptyProvider({
  variant,
  panel,
  children,
}: Partial<EmptyValue> & { children: ReactNode }) {
  return (
    <EmptyContext.Provider value={variant ? { variant, panel } : null}>{children}</EmptyContext.Provider>
  );
}

/** Null on a page that has data for the period. */
export const useEmpty = () => useContext(EmptyContext);
