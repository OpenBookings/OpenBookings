"use client";

import { formatCount, formatPercent, formatRange } from "@/lib/analytics/format";
import { COMPARE_LABELS } from "@/lib/analytics/period";
import type { PageData } from "@/lib/analytics/types";
import { ChartCard, WIDE, WidgetGrid } from "../chart-card";
import { Bars } from "../charts/bars";
import { TimeLine } from "../charts/time-line";
import { DateStrip } from "../date-strip";
import { Stat, StatRow } from "../stat-row";

const percent = (value: number | null) => formatPercent(value, 0);

export function OccupancyPageView({ data }: { data: PageData<"occupancy"> }) {
  const { view } = data;
  const periodLabel = formatRange(data.range);

  return (
    <>
      <StatRow>
        <Stat
          label="Occupancy"
          widget={view.occupancy}
          format={percent}
          info="Share of the nights you made available on OpenBookings that were sold here. Rooms marked out of order are left out; dates you closed for sale still count as available."
        />
        <Stat label="Nights sold" widget={view.nightsSold} format={formatCount} />
        <Stat label="Nights available" widget={view.nightsAvailable} format={formatCount} />
        <Stat
          label="Unsold, next 30 days"
          widget={view.unsoldNext30}
          format={formatCount}
          info="Nights still available over the next 30 days, counted from today. The period does not change it."
        />
      </StatRow>

      <WidgetGrid>
        <ChartCard
          title={view.overTimeGranularity === "day" ? "Occupancy by day" : "Occupancy by week"}
          unit="%"
          basis="stay"
          periodLabel={periodLabel}
          widget={view.overTime}
          className={WIDE}
        >
          {(points) => (
            <TimeLine
              points={points}
              label="Occupancy"
              compareLabel={COMPARE_LABELS[data.compare]}
              format={percent}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Next 90 days"
          unit="Nights sold of available"
          basis="stay"
          periodLabel="From today"
          widget={view.next90}
          emptyMessage="No rooms are available in the next 90 days."
          className={WIDE}
        >
          {(cells) => <DateStrip cells={cells} />}
        </ChartCard>

        {view.pace ? (
          <ChartCard
            title="Pace, next 13 weeks"
            unit="Nights on the books"
            basis="stay"
            periodLabel="Against the same point last year"
            widget={view.pace}
            emptyMessage="Nothing is on the books for the next 13 weeks yet."
          >
            {(points) => (
              <TimeLine
                points={points}
                label="On the books now"
                compareLabel="Same point last year"
                format={formatCount}
              />
            )}
          </ChartCard>
        ) : null}

        <ChartCard
          title="Occupancy by weekday"
          unit="%"
          basis="stay"
          periodLabel={periodLabel}
          widget={view.byWeekday}
        >
          {(rows) => (
            <Bars
              rows={rows.map((row) => ({ ...row, label: row.label.slice(0, 3) }))}
              label="Occupancy"
              format={percent}
              summary={`Occupancy by weekday. ${rows.map((r) => `${r.label} ${percent(r.value)}`).join(", ")}.`}
            />
          )}
        </ChartCard>
      </WidgetGrid>
    </>
  );
}
