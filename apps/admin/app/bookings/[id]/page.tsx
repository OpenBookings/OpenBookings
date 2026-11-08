import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@openbookings/db";
import { CopyId } from "./copy-id";
import { ForcedPanel } from "./forced-panel";
import { RealActionsPanel } from "./real-actions-panel";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadAdminBooking } from "@/lib/booking";
import { buildTimeline } from "@/lib/timeline";
import { allowedFor } from "@/lib/real-actions";
import { requireSuperAdmin } from "@/lib/super-admin";

const eur = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

function fmt(d: Date | string | null, tz: string): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(d));
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  requireSuperAdmin();
  const { id } = await params;
  const data = await loadAdminBooking(getPool(), id);
  if (!data) notFound();

  const { booking, guest, property, rooms, transactions, refunds, messages, tickets } = data;
  const tz = property.timezone;
  const timeline = buildTimeline(data);
  const initial = { guest: await allowedFor(id, "guest"), host: await allowedFor(id, "host") };

  const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + Number(x.amount), 0);
  const paid = sum(transactions.filter((t) => t.type === "charge" && t.status === "succeeded"));
  const refunded = sum(refunds.filter((r) => r.status === "succeeded"));
  const pending = sum(refunds.filter((r) => r.status !== "succeeded"));
  const failedCharges = sum(transactions.filter((t) => t.type === "charge" && t.status !== "succeeded"));

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-xl">{booking.id}</h1>
          <CopyId id={booking.id} />
          <Badge variant="secondary">{booking.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {property.name} · {String(booking.check_in_date)} → {String(booking.check_out_date)} ·{" "}
          {eur.format(Number(booking.total_amount))} · Booking fee {eur.format(Number(booking.booking_fee_amount ?? 0))}
        </p>
        <p className="text-sm">
          Guest: {guest?.name ?? "-"} <span className="text-muted-foreground">{guest?.email}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Created {fmt(booking.created_at, tz)} ({tz}) · payment intent{" "}
          <span className="font-mono">{String(booking.stripe_payment_intent_id ?? "-")}</span>
        </p>
        {booking.guest_notes ? <p className="text-sm">Notes: {String(booking.guest_notes)}</p> : null}
        {booking.cancellation_reason ? (
          <p className="text-sm">Cancellation reason: {String(booking.cancellation_reason)}</p>
        ) : null}
      </header>

      <Section title="Rooms">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reservation</TableHead>
              <TableHead>Room</TableHead>
              <TableHead>Rate plan</TableHead>
              <TableHead>Guests</TableHead>
              <TableHead>Nights</TableHead>
              <TableHead className="text-right">Per night</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead>Free cancellation until</TableHead>
              <TableHead className="text-right">Tourist tax</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Cancelled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.id.slice(0, 8)}</TableCell>
                <TableCell>{r.room_name}</TableCell>
                <TableCell>{r.rate_plan_name}</TableCell>
                <TableCell>
                  {String(r.adults)}A {String(r.children ?? 0)}C
                </TableCell>
                <TableCell>{String(r.total_nights)}</TableCell>
                <TableCell className="text-right">{eur.format(Number(r.price_per_night))}</TableCell>
                <TableCell>{String(r.cancellation_tier ?? "-")}</TableCell>
                <TableCell>
                  {r.full_refund_until ? fmt(r.full_refund_until as Date, tz) : "none (non-refundable)"}
                </TableCell>
                <TableCell className="text-right">{eur.format(Number(r.tourist_tax_amount ?? 0))}</TableCell>
                <TableCell className="text-right">{eur.format(Number(r.total_amount))}</TableCell>
                <TableCell>{r.cancelled_at ? fmt(r.cancelled_at, tz) : "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Money">
        <p className="text-sm">
          Paid {eur.format(paid)} · Refunded {eur.format(refunded)} · Pending/failed refunds {eur.format(pending)}
          {failedCharges > 0 ? ` · Unsuccessful charges ${eur.format(failedCharges)}` : ""}
        </p>
        <h3 className="text-sm font-medium">Transactions</h3>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Provider id</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Failure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{fmt(t.created_at, tz)}</TableCell>
                  <TableCell>{t.type}</TableCell>
                  <TableCell>{String(t.provider ?? "-")}</TableCell>
                  <TableCell className="font-mono">{String(t.provider_payment_id ?? "-")}</TableCell>
                  <TableCell>{t.status}</TableCell>
                  <TableCell className="text-right">{eur.format(Number(t.amount))}</TableCell>
                  <TableCell>{[t.failure_code, t.failure_message].filter(Boolean).join(": ") || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <h3 className="text-sm font-medium">Refunds</h3>
        {refunds.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reservation</TableHead>
                <TableHead>Stripe refund</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{fmt(r.created_at, tz)}</TableCell>
                  <TableCell>{r.reason}</TableCell>
                  <TableCell>{r.status}</TableCell>
                  <TableCell className="font-mono">{r.reservation_id?.slice(0, 8) ?? "-"}</TableCell>
                  <TableCell className="font-mono">{String(r.stripe_refund_id ?? "-")}</TableCell>
                  <TableCell>{r.created_by ?? "system"}</TableCell>
                  <TableCell className="text-right">{eur.format(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Timeline">
        <ol className="space-y-2">
          {timeline.map((e, i) => (
            <li key={i} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">{fmt(e.at, tz)}</span>
                <span className="font-medium">{e.kind}</span>
                <span className="text-muted-foreground">
                  {e.actorKind}
                  {e.actorId ? `:${e.actorId}` : ""}
                </span>
                {e.reservationId ? <span className="font-mono text-xs">{e.reservationId.slice(0, 8)}</span> : null}
                {e.reconstructed ? <Badge variant="outline">reconstructed</Badge> : null}
              </div>
              {e.reason ? <div>Reason: {e.reason}</div> : null}
              {Object.keys(e.data).length > 0 ? (
                <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">{JSON.stringify(e.data)}</pre>
              ) : null}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Messages">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="rounded-md border p-3 text-sm">
                <div className="text-xs text-muted-foreground">
                  {m.sender_role} · {fmt(m.created_at, tz)}
                </div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Support tickets">
        {tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {tickets.map((t) => (
              <li key={t.id}>
                #{t.chatwoot_conversation_id} {t.title} <Badge variant="secondary">{t.status}</Badge>{" "}
                <span className="text-muted-foreground">
                  {t.category} · {fmt(t.last_activity_at, tz)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="actions" title="Actions">
        <RealActionsPanel
          bookingId={booking.id}
          rooms={rooms.map((r) => ({ id: r.id, name: r.room_name, cancelled: r.cancelled_at != null }))}
          initial={initial}
        />
        <ForcedPanel
          bookingId={booking.id}
          status={String(booking.status)}
          rooms={rooms.map((r) => ({ id: r.id, name: r.room_name, cancelled: r.cancelled_at != null }))}
          refunds={refunds.map((r) => ({ id: r.id, reason: String(r.reason), amount: Number(r.amount), status: String(r.status) }))}
        />
      </Section>

      <details className="text-xs">
        <summary className="cursor-pointer text-sm">Raw data</summary>
        <pre className="mt-2 overflow-x-auto">{JSON.stringify({ booking, rooms, refunds }, null, 2)}</pre>
      </details>

      <Link href="/" className="text-sm underline">
        Back to search
      </Link>
    </div>
  );
}
