"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { formatEuros, formatRange } from "@/lib/analytics/format";
import { COMPARE_LABELS } from "@/lib/analytics/period";
import type { PageData } from "@/lib/analytics/types";
import { ChartCard, WIDE, WidgetGrid } from "../chart-card";
import { RankedBars } from "../charts/ranked-bars";
import { TimeLine } from "../charts/time-line";
import { Stat, StatRow } from "../stat-row";

export function RevenuePageView({ data }: { data: PageData<"revenue"> }) {
  const { view } = data;
  const [dimension, setDimension] = React.useState<"room" | "plan">("room");
  const periodLabel = formatRange(data.range);

  return (
    <>
      <StatRow>
        <Stat
          label="Revenue"
          widget={view.revenue}
          format={formatEuros}
          info="Net room revenue from bookings made in this period: excluding VAT, tourist tax and non-room fees, after discounts."
        />
        <Stat
          label="Year to date"
          widget={view.yearToDate}
          format={formatEuros}
          info="Net room revenue from bookings made since 1 January. The period does not change it."
        />
        <Stat
          label="ADR"
          widget={view.adr}
          format={formatEuros}
          info="Average daily rate: room revenue divided by nights sold, for nights stayed in this period."
        />
        <Stat
          label="RevPAR"
          widget={view.revpar}
          format={formatEuros}
          info="Revenue per available room night: ADR multiplied by occupancy. Read next to ADR, it tells you whether weak revenue comes from a low price or from empty rooms."
        />
        <Stat
          label="Commission"
          widget={view.commission}
          format={formatEuros}
          info="OpenBookings' commission on the bookings made in this period, as charged: your rate on the room price including VAT, rounded per booking and never on tourist tax. Revenue here is shown without VAT, so this is more than your rate times that figure. It includes commission on fees you kept from cancellations."
          href="/dashboard/finance"
          hrefLabel="Statements in Finance"
        />
      </StatRow>

      <WidgetGrid>
        <ChartCard
          title="Revenue over time"
          unit="EUR"
          basis="booking"
          periodLabel={periodLabel}
          widget={view.overTime}
          className={WIDE}
        >
          {(points) => (
            <TimeLine
              points={points}
              label="Revenue"
              compareLabel={COMPARE_LABELS[data.compare]}
              format={formatEuros}
            />
          )}
        </ChartCard>

        <ChartCard
          title={dimension === "room" ? "Revenue by room type" : "Revenue by rate plan"}
          unit="EUR"
          basis="booking"
          periodLabel={periodLabel}
          widget={dimension === "room" ? view.byRoomType : view.byRatePlan}
          action={
            <div className="flex shrink-0 gap-1" role="group" aria-label="Break revenue down by">
              <Button
                variant={dimension === "room" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={dimension === "room"}
                onClick={() => setDimension("room")}
              >
                Room type
              </Button>
              <Button
                variant={dimension === "plan" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={dimension === "plan"}
                onClick={() => setDimension("plan")}
              >
                Rate plan
              </Button>
            </div>
          }
        >
          {(rows) => <RankedBars rows={rows} format={formatEuros} />}
        </ChartCard>
      </WidgetGrid>
    </>
  );
}
