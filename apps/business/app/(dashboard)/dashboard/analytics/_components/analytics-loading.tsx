"use client";

import { useSearchParams } from "next/navigation";
import { CalendarIcon, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAGES, type PageId } from "@/lib/analytics/pages";
import { amsterdamToday, parseCompareParam, parsePeriodParams } from "@/lib/analytics/period";
import { AnalyticsLoader, LoaderStage } from "./analytics-loader";
import { periodSummary } from "./period-control";

/**
 * What loading.tsx shows for each page: the real header straight away (the
 * link says which page and which period), Period and Export dimmed, and the
 * loader alone in the empty content area.
 */
export function AnalyticsLoading({ page }: { page: PageId }) {
  const meta = PAGES[page];
  const searchParams = useSearchParams();
  const params = Object.fromEntries(searchParams.entries());
  const period = parsePeriodParams(params, amsterdamToday());
  const summary = periodSummary(period.preset, period, parseCompareParam(params.compare));

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 lg:px-6">
        <div className="min-w-0">
          <h1 className="font-semibold text-lg">{meta.title}</h1>
          <p className="text-muted-foreground text-sm">{meta.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled tabIndex={-1}>
            <CalendarIcon aria-hidden />
            {summary}
          </Button>
          <Button variant="outline" size="sm" disabled tabIndex={-1}>
            <Download aria-hidden />
            Export CSV
          </Button>
        </div>
      </div>
      <LoaderStage>
        <AnalyticsLoader page={page} track />
      </LoaderStage>
    </>
  );
}
