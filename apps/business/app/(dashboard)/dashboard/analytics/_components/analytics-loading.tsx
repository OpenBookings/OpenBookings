"use client";

import { useSearchParams } from "next/navigation";
import { CalendarIcon, Download } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
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
      <PageHeader
        title={meta.title}
        description={meta.description}
        className="px-4 lg:px-6"
        actions={
          <>
            <Button variant="outline" size="sm" disabled tabIndex={-1}>
              <CalendarIcon aria-hidden />
              {summary}
            </Button>
            <Button variant="outline" size="sm" disabled tabIndex={-1}>
              <Download aria-hidden />
              Export CSV
            </Button>
          </>
        }
      />
      <LoaderStage>
        <AnalyticsLoader page={page} track />
      </LoaderStage>
    </>
  );
}
