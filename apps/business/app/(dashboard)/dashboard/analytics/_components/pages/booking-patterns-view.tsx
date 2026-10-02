"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatCents, formatCount, formatDays, formatNights, formatPercent, formatRange,
} from "@/lib/analytics/format";
import type { Bar, PageData } from "@/lib/analytics/types";
import { ChartCard, WIDE, WidgetGrid } from "../chart-card";
import { Bars } from "../charts/bars";
import { Stat, StatRow } from "../stat-row";

const summarise = (title: string, rows: Bar[]) =>
  `${title}. ${rows.map((r) => `${r.label}: ${formatCount(r.value)}`).join(", ")}.`;

export function BookingPatternsPageView({ data }: { data: PageData<"booking-patterns"> }) {
  const { view } = data;
  const periodLabel = formatRange(data.range);

  return (
    <>
      <StatRow>
        <Stat label="Bookings" widget={view.bookings} format={formatCount} info="Bookings made in this period, including ones later cancelled." />
        <Stat label="Median lead time" widget={view.medianLeadDays} format={formatDays} info="Half of your bookings are made at least this many days before check-in." />
        <Stat label="Median stay length" widget={view.medianStayNights} format={formatNights} info="Half of your stays are at least this long. Cancelled bookings are left out." />
        <Stat label="Cancellation rate" widget={view.cancellationRate} format={formatPercent} info="Share of the bookings made in this period that have been cancelled." />
      </StatRow>

      <WidgetGrid>
        <ChartCard title="Lead time" unit="Bookings" basis="booking" periodLabel={periodLabel} widget={view.leadTime}>
          {(rows) => <Bars rows={rows} label="Bookings" format={formatCount} summary={summarise("Bookings by lead time", rows)} />}
        </ChartCard>

        <ChartCard title="Stay length" unit="Bookings" basis="booking" periodLabel={periodLabel} widget={view.stayLength}>
          {(rows) => <Bars rows={rows} label="Bookings" format={formatCount} summary={summarise("Bookings by stay length", rows)} />}
        </ChartCard>

        <ChartCard
          title="Cancellations by days before check-in"
          unit="Cancelled bookings"
          basis="booking"
          periodLabel={periodLabel}
          widget={view.cancellationsByDaysBefore}
          sampleUnit="cancellations"
        >
          {(rows) => <Bars rows={rows} label="Cancellations" format={formatCount} summary={summarise("Cancellations by days before check-in", rows)} />}
        </ChartCard>

        <ChartCard
          title="Cancellations by rate plan"
          unit="Rate and fees retained"
          basis="booking"
          periodLabel={periodLabel}
          widget={view.byRatePlan}
          className={WIDE}
        >
          {(rows) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate plan</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">Cancellation rate</TableHead>
                  <TableHead className="text-right">Fees retained</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.bookings)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.cancelled)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.ratePct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(row.feesRetainedCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ChartCard>
      </WidgetGrid>
    </>
  );
}
