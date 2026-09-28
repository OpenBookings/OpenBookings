"use client";

// The section tree renders on the client. Every widget hands WidgetFrame a
// render prop and every chart a formatter, and a function cannot cross a
// server-to-client boundary — React rejects it at render. The seam the spec
// cares about is untouched: getAnalytics() still derives on the server and only
// the finished view model is serialized, never the fact rows.

import { formatCount, formatNights, formatPercent } from "@/lib/analytics/format";
import type { AnalyticsData } from "@/lib/analytics/types";
import { RankedBarChart } from "./charts/bar-chart";
import { UpcomingStackedBar } from "./charts/stacked-bar";
import { KpiValue } from "./kpi-card";
import { ChartGrid, KpiGrid, SectionShell } from "./section-shell";
import { WidgetFrame } from "./widget-frame";

export function BookingsSectionView({ data }: { data: AnalyticsData }) {
  const { bookings } = data;

  return (
    <SectionShell
      id="bookings"
      title="Bookings"
      description="Bookings created in the selected period, cancelled ones included."
      data={data}
    >
      <KpiGrid>
        <WidgetFrame
          title="Number of bookings"
          definition="Bookings created in the period. Cancelled bookings are counted here."
          widget={bookings.count}
        >
          {(v) => <KpiValue value={formatCount(v.value)} delta={v.delta} />}
        </WidgetFrame>

        <WidgetFrame
          title="Average length of stay"
          definition="Average nights per booking. Cancelled bookings are excluded — they never stayed."
          widget={bookings.averageLengthOfStay}
        >
          {(nights) => <KpiValue value={formatNights(nights)} />}
        </WidgetFrame>

        <WidgetFrame
          title="Cancellations"
          definition="Bookings made in this period that were later cancelled, as a count and a share."
          widget={bookings.cancellations}
        >
          {(v) => (
            <KpiValue
              value={`${formatCount(v.count)} (${formatPercent(v.value)})`}
              delta={v.delta}
            />
          )}
        </WidgetFrame>
      </KpiGrid>

      <ChartGrid>
        <WidgetFrame
          title="Lead time"
          definition="Days between a booking being made and its check-in date."
          widget={bookings.leadTime}
          bookingsInPeriod={data.bookingsInPeriod}
          requiresDetail
        >
          {(rows) => (
            <RankedBarChart
              rows={rows}
              label="Bookings"
              format={(v) => formatCount(v)}
              sorted={false}
              summary={`Lead time. ${rows
                .map((r) => `${r.label}: ${formatCount(r.value)} bookings`)
                .join(", ")}.`}
            />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="Upcoming 30 / 60 / 90 days"
          definition="Always measured from today, whatever period is selected."
          widget={bookings.upcoming}
        >
          {(windows) => <UpcomingStackedBar windows={windows} />}
        </WidgetFrame>
      </ChartGrid>
    </SectionShell>
  );
}
