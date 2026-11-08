import { TriangleAlert } from "lucide-react";
import { formatEuro } from "@openbookings/billing/money";
import { formatDay, formatMonth, formatStay } from "@openbookings/billing/render/document";
import type { UpcomingInvoice } from "@/lib/billing/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * This month's running commission, worked out the way the monthly invoice
 * will be. A preview only: nothing here is issued yet, and it holds no guest
 * names or contact details.
 */
export function UpcomingInvoiceCard({ upcoming }: { upcoming: UpcomingInvoice }) {
  const { period, rows, totals, treatment, blockers } = upcoming;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Upcoming invoice
          <Badge variant="outline">{formatMonth(period.start)}</Badge>
        </CardTitle>
        <CardDescription>
          What has been charged so far this month. It is issued after the month ends and can still change until then,
          for example when a booking is cancelled.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {blockers.length > 0 ? (
          <div role="alert" className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="font-medium">This invoice can&apos;t be issued yet</p>
              <ul className="list-disc pl-4 text-muted-foreground">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {treatment ? <p className="text-muted-foreground">{treatment.label}</p> : null}

        {rows.length === 0 ? (
          <p className="text-muted-foreground">Nothing yet this month.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Stay</TableHead>
                  <TableHead className="text-right">Booking value</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.bookingRef}-${r.stripePaymentRef}-${i}`}>
                    <TableCell className="font-medium">
                      {r.bookingRef || "–"}
                      {r.refundNote ? <span className="block text-xs font-normal text-muted-foreground">{r.refundNote}</span> : null}
                    </TableCell>
                    <TableCell>{formatDay(r.paidOn)}</TableCell>
                    <TableCell>{r.stayStart && r.stayEnd ? formatStay(r.stayStart, r.stayEnd) : "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(r.base)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(r.gross)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {totals ? (
              <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
                <dt className="text-muted-foreground">Net</dt>
                <dd className="text-right tabular-nums">{formatEuro(totals.netTotal)}</dd>
                <dt className="text-muted-foreground">VAT</dt>
                <dd className="text-right tabular-nums">{formatEuro(totals.vatTotal)}</dd>
                <dt className="font-medium">{totals.docType === "credit_note" ? "Credit note total" : "Total"}</dt>
                <dd className="text-right font-medium tabular-nums">{formatEuro(totals.grossTotal)}</dd>
              </dl>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
