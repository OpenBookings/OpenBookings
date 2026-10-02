"use client";

import { formatCount, formatPercent, formatRange } from "@/lib/analytics/format";
import type { PageData } from "@/lib/analytics/types";
import { ChartCard, WidgetGrid } from "../chart-card";
import { RankedBars } from "../charts/ranked-bars";
import { StackedBar } from "../charts/stacked-bar";
import { Stat, StatRow } from "../stat-row";

const bookings = (value: number) => `${formatCount(value)} ${value === 1 ? "booking" : "bookings"}`;
const partySize = (value: number | null) => (value === null ? "—" : `${value} ${value === 1 ? "guest" : "guests"}`);

export function GuestsPageView({ data }: { data: PageData<"guests"> }) {
  const { view } = data;
  const periodLabel = formatRange(data.range);

  return (
    <>
      <StatRow>
        <Stat
          label="Returning guests"
          widget={view.returning}
          format={(value) => formatPercent(value, 0)}
          info="Share of bookings from guests who had stayed with you before, measured across all your history."
        />
        <Stat
          label="Median party size"
          widget={view.medianPartySize}
          format={partySize}
          info="Half of your bookings are for at least this many guests, adults and children together."
        />
      </StatRow>

      <WidgetGrid>
        <ChartCard
          title="Booker country"
          unit="Bookings"
          basis="booking"
          periodLabel={periodLabel}
          widget={view.countries}
          sampleUnit="guests"
        >
          {(rows) => <RankedBars rows={rows} format={bookings} />}
        </ChartCard>

        <ChartCard
          title="Group type"
          unit="Bookings"
          basis="booking"
          periodLabel={periodLabel}
          widget={view.groupTypes}
          sampleUnit="guests"
        >
          {(rows) => (
            <StackedBar
              rows={rows}
              format={(value) => formatCount(value)}
              summary={`Bookings by group type. ${rows.map((r) => `${r.label}: ${formatCount(r.value)}`).join(", ")}.`}
            />
          )}
        </ChartCard>
      </WidgetGrid>

      <p className="px-4 text-muted-foreground text-xs lg:px-6">
        Totals only. Any group with fewer than five guests is shown as Other, here and in the export, so no single guest can be identified.
      </p>
    </>
  );
}
