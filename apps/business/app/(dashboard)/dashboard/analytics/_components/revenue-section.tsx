"use client";

// The section tree renders on the client. Every widget hands WidgetFrame a
// render prop and every chart a formatter, and a function cannot cross a
// server-to-client boundary — React rejects it at render. The seam the spec
// cares about is untouched: getAnalytics() still derives on the server and only
// the finished view model is serialized, never the fact rows.

import { formatCents } from "@/lib/analytics/format";
import type { AnalyticsData } from "@/lib/analytics/types";
import { RankedBarChart } from "./charts/bar-chart";
import { TrendLineChart } from "./charts/line-chart";
import { KpiValue } from "./kpi-card";
import { ChartGrid, KpiGrid, SectionShell } from "./section-shell";
import { WidgetFrame } from "./widget-frame";

export function RevenueSectionView({ data }: { data: AnalyticsData }) {
  const { revenue } = data;
  const isEmpty = data.bookingsInPeriod === 0;

  return (
    <SectionShell
      id="revenue"
      title="Revenue"
      description="Net room revenue, excluding VAT, tourist tax and non-room fees, after discounts."
      data={data}
    >
      <KpiGrid>
        <WidgetFrame
          title="Year to date"
          definition="Net room revenue from 1 January to today. This one ignores the period selector."
          widget={revenue.yearToDateCents}
        >
          {(v) => <KpiValue value={formatCents(v.value)} delta={v.delta} />}
        </WidgetFrame>

        <WidgetFrame
          title="Revenue (selected period)"
          definition="Net room revenue in the selected period, compared with the previous period of the same length."
          widget={revenue.periodCents}
        >
          {(v) => <KpiValue value={formatCents(v.value)} delta={v.delta} />}
        </WidgetFrame>

        <WidgetFrame
          title="Average room price (ADR)"
          definition="Net room revenue divided by nights sold."
          widget={revenue.adrCents}
        >
          {(v) => (
            <KpiValue value={formatCents(v.value)} spark={v.spark} sparkLabel="Revenue" />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="RevPAR"
          definition="Net room revenue divided by nights available — what every room you opened earned on average, sold or not."
          widget={revenue.revparCents}
        >
          {(v) => (
            <KpiValue value={formatCents(v.value)} spark={v.spark} sparkLabel="Revenue" />
          )}
        </WidgetFrame>
      </KpiGrid>

      <ChartGrid>
        <WidgetFrame title="Revenue over time" widget={revenue.overTime} isEmpty={isEmpty}>
          {(points) => (
            <TrendLineChart points={points} label="Revenue" format={formatCents} />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="Commission paid"
          definition="OpenBookings' commission: 4.5% of net room revenue."
          widget={revenue.commissionCents}
        >
          {(cents) => <KpiValue value={formatCents(cents)} />}
        </WidgetFrame>

        <WidgetFrame title="Revenue by room type" widget={revenue.byRoomType} isEmpty={isEmpty}>
          {(rows) => (
            <RankedBarChart
              rows={rows}
              label="Revenue"
              format={formatCents}
              summary={`Revenue by room type. ${rows
                .map((r) => `${r.label} ${formatCents(r.value)}`)
                .join(", ")}.`}
            />
          )}
        </WidgetFrame>

        <WidgetFrame title="Revenue by rate plan" widget={revenue.byRatePlan} isEmpty={isEmpty}>
          {(rows) => (
            <RankedBarChart
              rows={rows}
              label="Revenue"
              format={formatCents}
              summary={`Revenue by rate plan. ${rows
                .map((r) => `${r.label} ${formatCents(r.value)}`)
                .join(", ")}.`}
            />
          )}
        </WidgetFrame>
      </ChartGrid>
    </SectionShell>
  );
}
