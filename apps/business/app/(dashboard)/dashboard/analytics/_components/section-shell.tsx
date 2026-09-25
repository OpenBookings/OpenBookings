"use client";

// The section tree renders on the client. Every widget hands WidgetFrame a
// render prop and every chart a formatter, and a function cannot cross a
// server-to-client boundary — React rejects it at render. The seam the spec
// cares about is untouched: getAnalytics() still derives on the server and only
// the finished view model is serialized, never the fact rows.

import type { ReactNode } from "react";
import type { SectionId } from "@/lib/analytics/csv";
import type { AnalyticsData } from "@/lib/analytics/types";
import { ExportButton } from "./export-button";

/**
 * Heading, export button, content. The export sits in the heading so it is
 * reachable in visual order: a keyboard user tabs the section title, then its
 * export, then into its widgets.
 */
export function SectionShell({
  id,
  title,
  description,
  data,
  children,
}: {
  id: SectionId;
  title: string;
  description: string;
  data: AnalyticsData;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`analytics-${id}`} className="space-y-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`analytics-${id}`} className="font-semibold text-lg">
            {title}
          </h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <ExportButton data={data} section={id} label={title} />
      </div>
      {children}
    </section>
  );
}

export const KpiGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-4 @lg/main:grid-cols-2 @4xl/main:grid-cols-4">{children}</div>
);

export const ChartGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-4 @4xl/main:grid-cols-2">{children}</div>
);
