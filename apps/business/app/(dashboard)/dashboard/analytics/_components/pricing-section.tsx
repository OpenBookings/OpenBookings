"use client";

// The section tree renders on the client. Every widget hands WidgetFrame a
// render prop and every chart a formatter, and a function cannot cross a
// server-to-client boundary — React rejects it at render. The seam the spec
// cares about is untouched: getAnalytics() still derives on the server and only
// the finished view model is serialized, never the fact rows.

import { formatCents, formatCount, formatPercent } from "@/lib/analytics/format";
import type { AnalyticsData } from "@/lib/analytics/types";
import { DualLineChart } from "./charts/line-chart";
import { KpiValue } from "./kpi-card";
import { RankedList } from "./ranked-list";
import { ChartGrid, KpiGrid, SectionShell } from "./section-shell";
import { WidgetFrame } from "./widget-frame";

export function PricingSectionView({ data }: { data: AnalyticsData }) {
  const { pricing } = data;
  const isEmpty = data.bookingsInPeriod === 0;

  return (
    <SectionShell
      id="pricing"
      title="Pricing"
      description="Base price is the rate plan's price for that night before modifiers. Achieved price is what was actually paid, net."
      data={data}
    >
      <KpiGrid>
        <WidgetFrame
          title="Average discount given"
          definition="The gap between base price and achieved price, weighted by nights sold. A surcharge shows as a negative discount."
          widget={pricing.averageDiscountPct}
        >
          {(value) => <KpiValue value={formatPercent(value)} />}
        </WidgetFrame>
      </KpiGrid>

      <ChartGrid>
        <WidgetFrame
          title="Achieved price vs. base price"
          widget={pricing.priceOverTime}
          isEmpty={isEmpty}
        >
          {(v) => (
            <DualLineChart
              series={[
                { key: "base", label: "Base price", points: v.base },
                { key: "achieved", label: "Achieved price", points: v.achieved },
              ]}
              format={formatCents}
              summary={buildPriceSummary(v)}
            />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="Most-used discounts & modifiers"
          definition="Ranked by how much money each moved, in either direction."
          widget={pricing.topModifiers}
        >
          {(rows) => (
            <RankedList
              rows={rows}
              format={formatCents}
              countLabel={(count) => `applied ${formatCount(count)}×`}
            />
          )}
        </WidgetFrame>
      </ChartGrid>
    </SectionShell>
  );
}

/** Summarises both lines at once, since the point of the chart is the gap. */
function buildPriceSummary(v: {
  base: { value: number; label: string }[];
  achieved: { value: number; label: string }[];
}): string {
  if (v.base.length === 0) return "Base and achieved price have no data in this period.";
  const last = v.base.length - 1;
  return `Base against achieved price. Base moved from ${formatCents(v.base[0].value)} to ${formatCents(
    v.base[last].value,
  )}; achieved moved from ${formatCents(v.achieved[0].value)} to ${formatCents(
    v.achieved[last].value,
  )}.`;
}
