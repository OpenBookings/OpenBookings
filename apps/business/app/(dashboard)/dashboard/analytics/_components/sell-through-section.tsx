"use client";

// The section tree renders on the client. Every widget hands WidgetFrame a
// render prop and every chart a formatter, and a function cannot cross a
// server-to-client boundary — React rejects it at render. The seam the spec
// cares about is untouched: getAnalytics() still derives on the server and only
// the finished view model is serialized, never the fact rows.

import { formatCount, formatPercent } from "@/lib/analytics/format";
import type { AnalyticsData } from "@/lib/analytics/types";
import { RankedBarChart } from "./charts/bar-chart";
import { TrendLineChart } from "./charts/line-chart";
import { HeatmapTable } from "./heatmap-table";
import { KpiValue } from "./kpi-card";
import { ChartGrid, KpiGrid, SectionShell } from "./section-shell";
import { WidgetFrame } from "./widget-frame";

export function SellThroughSectionView({ data }: { data: AnalyticsData }) {
  const { sellThrough } = data;
  const isEmpty = data.bookingsInPeriod === 0;

  return (
    <SectionShell
      id="sell-through"
      title="Sell-through"
      description="Measured against the inventory you made available on OpenBookings, not your whole property."
      data={data}
    >
      <KpiGrid>
        <WidgetFrame
          title="Sell-through"
          definition="Nights sold divided by nights available on OpenBookings."
          widget={sellThrough.pct}
        >
          {(v) => <KpiValue value={formatPercent(v.value)} delta={v.delta} />}
        </WidgetFrame>

        <WidgetFrame
          title="Rooms sold"
          definition="Room-nights sold in the selected period."
          widget={sellThrough.roomsSold}
        >
          {(nights) => <KpiValue value={formatCount(nights)} />}
        </WidgetFrame>
      </KpiGrid>

      <ChartGrid>
        <WidgetFrame title="Sell-through over time" widget={sellThrough.overTime} isEmpty={isEmpty}>
          {(points) => (
            <TrendLineChart
              points={points}
              label="Sell-through"
              format={(v) => formatPercent(v)}
            />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="Sell-through by room type"
          widget={sellThrough.byRoomType}
          isEmpty={isEmpty}
        >
          {(rows) => (
            <RankedBarChart
              rows={rows}
              label="Sell-through"
              format={(v) => formatPercent(v)}
              summary={`Sell-through by room type. ${rows
                .map((r) => `${r.label} ${formatPercent(r.value)}`)
                .join(", ")}.`}
            />
          )}
        </WidgetFrame>
      </ChartGrid>

      <WidgetFrame
        title="Busiest days of the week"
        definition="Sell-through per weekday, one column per week in the period."
        widget={sellThrough.busiestDays}
        bookingsInPeriod={data.bookingsInPeriod}
        requiresDetail
      >
        {(heatmap) => <HeatmapTable heatmap={heatmap} />}
      </WidgetFrame>
    </SectionShell>
  );
}
