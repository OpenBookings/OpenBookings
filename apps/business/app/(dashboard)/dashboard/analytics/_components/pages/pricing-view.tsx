"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCents, formatCount, formatEuros, formatPercent, formatRange } from "@/lib/analytics/format";
import { COMPARE_LABELS } from "@/lib/analytics/period";
import type { PageData } from "@/lib/analytics/types";
import { ChartCard, WIDE, WidgetGrid } from "../chart-card";
import { TimeLine } from "../charts/time-line";
import { Stat, StatRow } from "../stat-row";

export function PricingPageView({ data }: { data: PageData<"pricing"> }) {
  const { view } = data;
  const periodLabel = formatRange(data.range);
  const share = view.discounts.ok ? view.discounts.value.shareOfBookingsPct : null;

  return (
    <>
      <StatRow>
        <Stat
          label="ADR"
          widget={view.adr}
          format={formatEuros}
          info="Average daily rate: room revenue divided by nights sold, for nights stayed in this period."
        />
        <Stat
          label="Discounts given"
          widget={view.discounts}
          format={formatEuros}
          info="The difference between your standing rate and what guests paid, on bookings made in this period."
          note={share === null ? null : `On ${formatPercent(share, 0)} of bookings`}
        />
        <Stat
          label="Average discount depth"
          widget={view.discountDepth}
          format={formatPercent}
          info="How far below your standing rate a discounted booking was, on average."
        />
      </StatRow>

      <WidgetGrid>
        <ChartCard
          title="ADR over time"
          unit="EUR"
          basis="stay"
          periodLabel={periodLabel}
          widget={view.adrOverTime}
          className={WIDE}
        >
          {(points) => (
            <TimeLine points={points} label="ADR" compareLabel={COMPARE_LABELS[data.compare]} format={formatEuros} />
          )}
        </ChartCard>

        <ChartCard title="By rate plan" unit="EUR" basis="booking" periodLabel={periodLabel} widget={view.byRatePlan}>
          {(rows) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate plan</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Nights</TableHead>
                  <TableHead className="text-right">ADR</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.bookings)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.nights)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(row.adrCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(row.revenueCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ChartCard>

        <ChartCard title="By weekday" unit="Occupancy and ADR" basis="stay" periodLabel={periodLabel} widget={view.byWeekday}>
          {(rows) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Weekday</TableHead>
                    <TableHead className="text-right">Occupancy</TableHead>
                    <TableHead className="text-right">ADR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.weekday}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPercent(row.occupancyPct, 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(row.adrCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.some((row) => row.hint) ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {rows
                    .filter((row) => row.hint)
                    .map((row) => (
                      <li key={row.weekday}>Rooms on {row.label} sell out below your average rate.</li>
                    ))}
                </ul>
              ) : null}
            </>
          )}
        </ChartCard>
      </WidgetGrid>
    </>
  );
}
