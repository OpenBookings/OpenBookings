"use client";

import * as React from "react";

/**
 * Lets a page name a URL segment in the header breadcrumb. SiteHeader builds
 * its trail from the pathname, which is right for "rates-availability" and
 * wrong for a room id: the host should read "Deluxe King", not a UUID.
 *
 * Only the page knows the name, and it renders below the header, so the name
 * travels up through this context rather than through props.
 */
interface BreadcrumbLabelsContext {
  labels: Record<string, string>;
  setLabel: (segment: string, label: string | null) => void;
}

const Context = React.createContext<BreadcrumbLabelsContext | null>(null);

export function BreadcrumbLabelsProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = React.useState<Record<string, string>>({});
  const setLabel = React.useCallback((segment: string, label: string | null) => {
    setLabels((prev) => {
      if (label === null) {
        if (!(segment in prev)) return prev;
        const next = { ...prev };
        delete next[segment];
        return next;
      }
      return prev[segment] === label ? prev : { ...prev, [segment]: label };
    });
  }, []);
  const value = React.useMemo(() => ({ labels, setLabel }), [labels, setLabel]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Labels set by the current page, keyed by raw URL segment. Empty outside a provider. */
export function useBreadcrumbLabels(): Record<string, string> {
  return React.useContext(Context)?.labels ?? {};
}

/** Render anywhere in a page to show `label` in place of `segment` in the breadcrumb. */
export function BreadcrumbLabel({ segment, label }: { segment: string; label: string }) {
  const setLabel = React.useContext(Context)?.setLabel;
  React.useEffect(() => {
    setLabel?.(segment, label);
    return () => setLabel?.(segment, null);
  }, [segment, label, setLabel]);
  return null;
}
