import Link from "next/link";
import { getPool } from "@openbookings/db";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bookingRef, loadFlaggedPayments, type FlagKind } from "@/lib/flagged-payments";
import { requireSuperAdmin } from "@/lib/super-admin";
import { ResolveForm } from "./resolve-form";

const KIND_LABEL: Record<FlagKind, string> = {
  "refund-outside": "Refund outside OpenBookings",
  "dispute-lost": "Lost dispute",
};

const euro = (cents: number | null) =>
  cents === null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(cents / 100);

const when = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Europe/Amsterdam", dateStyle: "medium", timeStyle: "short" });

/**
 * Refunds hosts made outside OpenBookings, and disputes they lost. A Dashboard
 * refund returned no commission (any goodwill return is made by hand); a lost
 * dispute returned it in proportion to the whole payment. Staff email the host
 * to ask what the money was for (the tourist tax on it stays the host's
 * responsibility).
 */
export default async function FlaggedPaymentsPage() {
  requireSuperAdmin();
  const flags = await loadFlaggedPayments(getPool());
  const open = flags.filter((f) => !f.resolvedAt).length;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Flagged payments</h1>
        <p className="text-sm text-muted-foreground">
          Refunds made in the host&apos;s own Stripe Dashboard and lost disputes. OpenBookings cannot tell whether
          that money was room price or tourist tax, so ask the host to explain. {open} open, {flags.length - open}{" "}
          resolved.
        </p>
      </div>

      {flags.length === 0 ? (
        <p className="text-muted-foreground">Nothing flagged.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Host</TableHead>
              <TableHead>Booking</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Stripe</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flags.map((f) => (
              <TableRow key={f.id} className="align-top">
                <TableCell className="whitespace-nowrap">{when(f.createdAt)}</TableCell>
                <TableCell>
                  <div>{f.organizationName ?? "Unknown organisation"}</div>
                  {f.ownerEmails.map((email) => (
                    <a key={email} href={`mailto:${email}`} className="block text-xs text-muted-foreground underline">
                      {email}
                    </a>
                  ))}
                </TableCell>
                <TableCell>
                  {f.bookingId ? (
                    <Link href={`/bookings/${f.bookingId}`} className="font-mono underline">
                      {bookingRef(f.bookingId)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={f.kind === "dispute-lost" ? "destructive" : "secondary"}>{KIND_LABEL[f.kind]}</Badge>
                  {f.reason && <div className="mt-1 text-xs text-muted-foreground">{f.reason}</div>}
                </TableCell>
                <TableCell className="text-right">{euro(f.amountCents)}</TableCell>
                <TableCell className="font-mono text-xs">
                  <div>{f.objectId}</div>
                  <div className="text-muted-foreground">{f.chargeId}</div>
                  {f.paymentIntentId && <div className="text-muted-foreground">{f.paymentIntentId}</div>}
                  <div className="text-muted-foreground">{f.stripeAccountId}</div>
                </TableCell>
                <TableCell>
                  {f.resolvedAt ? (
                    <div className="text-sm">
                      Resolved {when(f.resolvedAt)}
                      {f.resolvedNote && <div className="text-xs text-muted-foreground">{f.resolvedNote}</div>}
                    </div>
                  ) : (
                    <ResolveForm flagId={f.id} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
