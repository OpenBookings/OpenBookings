import Link from "next/link";
import { FileDown } from "lucide-react";
import { formatEuro } from "@openbookings/billing/money";
import { formatMonth } from "@openbookings/billing/render/document";
import type { InvoiceListRow } from "@/lib/billing/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function download(id: string, file: "pdf" | "csv") {
  return `/api/billing/invoices/${id}/download?file=${file}`;
}

/** The issued commission invoices and credit notes, newest month first, with their downloads. */
export function InvoiceList({ invoices }: { invoices: InvoiceListRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>
          One invoice per month for the commission OpenBookings keeps on your bookings. A refund after an invoice was
          issued shows up as a credit note in the month it happens.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No invoices yet. The first one is issued after the end of the first month with a booking.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">VAT</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.number}</TableCell>
                  <TableCell>{formatMonth(inv.periodStart)}</TableCell>
                  <TableCell>{inv.docType === "credit_note" ? "Credit note" : "Invoice"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(inv.netTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(inv.vatTotal)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatEuro(inv.grossTotal)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{inv.status === "sent" ? "Sent" : "Issued"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {inv.hasPdf || inv.hasCsv ? (
                      <span className="inline-flex gap-3">
                        {inv.hasPdf ? (
                          <Link href={download(inv.id, "pdf")} prefetch={false} className="inline-flex items-center gap-1 underline underline-offset-2">
                            <FileDown className="size-3.5" aria-hidden />
                            PDF
                          </Link>
                        ) : null}
                        {inv.hasCsv ? (
                          <Link href={download(inv.id, "csv")} prefetch={false} className="inline-flex items-center gap-1 underline underline-offset-2">
                            <FileDown className="size-3.5" aria-hidden />
                            CSV
                          </Link>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Preparing</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
