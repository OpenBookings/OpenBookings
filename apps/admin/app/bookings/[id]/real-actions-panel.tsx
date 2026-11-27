"use client";

import { useState, useTransition } from "react";
import type { BookingAction } from "@openbookings/pricing";
import { bookingReference } from "@openbookings/db/booking-reference";
import { formatCents, parseEuroInput } from "@openbookings/pricing/money";
import type { LifecycleResult } from "@openbookings/db/booking-lifecycle";
import { DangerousDialog } from "@/components/dangerous-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { DangerousAction, DangerousResult } from "@/lib/dangerous-actions";
import {
  adminCancelRooms,
  adminGoodwillRefund,
  adminMarkCheckedIn,
  adminMarkNoShow,
  adminPreviewRefund,
  adminRecordEarlyDeparture,
  adminRetryRefunds,
} from "@/lib/real-actions";
import type { ActAs } from "@/lib/actor";

type Allowed = { actor: boolean; actions: BookingAction[] };
type Preview = Awaited<ReturnType<typeof adminPreviewRefund>>;

/** A dangerous action waiting for the confirm dialog. */
type Ask = {
  action: DangerousAction;
  summary: string;
  run: (c: { reason: string; stepUpToken: string }) => Promise<DangerousResult<LifecycleResult>>;
};

/** Cents as "€12.50". */
const eur = (cents: number) => formatCents(cents, { whole: "always-decimals" });

const IRREVERSIBLE = "This can't be undone.";

/** "Deluxe Double", "Deluxe Double and Twin", "3 rooms (A, B and C)". */
function roomList(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.length} rooms (${names.slice(0, -1).join(", ")} and ${names.at(-1)})`;
}

export function RealActionsPanel({
  bookingId,
  rooms,
  initial,
  guestName,
  heldCents,
  openRefunds,
}: {
  bookingId: string;
  rooms: { id: string; name: string; cancelled: boolean }[];
  initial: Record<ActAs, Allowed>;
  /** The guest as the page shows them, for the summaries. */
  guestName: string;
  /** Paid and not refunded (by OpenBookings or outside it), cents. */
  heldCents: number;
  /** OpenBookings refunds still pending or failed: what Retry refunds sends again. */
  openRefunds: { count: number; cents: number };
}) {
  const [as, setAs] = useState<ActAs>("guest");
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | "none">();
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<LifecycleResult | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [pending, start] = useTransition();

  const ref = bookingReference(bookingId);
  const allowed = initial[as];
  const can = (a: BookingAction) => allowed.actor && !pending && allowed.actions.includes(a);
  const ids = selected.length > 0 ? selected : null;
  const active = rooms.filter((r) => !r.cancelled);
  const [failure, setFailure] = useState<string | null>(null);
  const goodwill = amount === "" ? null : parseEuroInput(amount);
  const goodwillCents = goodwill?.ok && goodwill.cents > 0 ? goodwill.cents : null;

  const perform = (fn: () => Promise<LifecycleResult>) =>
    start(async () => {
      setFailure(null);
      try {
        setResult(await fn());
        setPreview(undefined);
        setSelected([]);
      } catch (e) {
        setResult(null);
        setFailure(e instanceof Error ? e.message : String(e));
      }
    });
  const doPreview = () =>
    start(async () => {
      setFailure(null);
      try {
        setPreview((await adminPreviewRefund(bookingId, ids)) ?? "none");
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e));
      }
    });

  /** Works out the refund first, when there is one, so the summary can name it. */
  const confirm = (prepare: () => Promise<Ask>) =>
    start(async () => {
      setFailure(null);
      try {
        setAsk(await prepare());
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e));
      }
    });

  const refundLine = (cents: number | null | undefined) =>
    cents == null
      ? "The refund could not be worked out in advance; the booking's rules decide it."
      : cents > 0
        ? `Refund ${eur(cents)} to ${guestName}.`
        : `${guestName} gets no refund.`;

  const askCancel = () =>
    confirm(async () => {
      const p = await adminPreviewRefund(bookingId, ids, as);
      const names = ids ? active.filter((r) => ids.includes(r.id)).map((r) => r.name) : active.map((r) => r.name);
      const all = !ids || ids.length === active.length;
      return {
        action: "booking.cancel_rooms",
        summary: [
          `Cancel ${roomList(names)} on ${ref} as the ${as}${all ? ", which cancels the booking" : ""}.`,
          refundLine(p?.totalCents),
          `Emails go out. ${IRREVERSIBLE}`,
        ].join(" "),
        run: (c) => adminCancelRooms(bookingId, as, ids, c),
      };
    });

  const askNoShow = () =>
    confirm(async () => ({
      action: "booking.mark_no_show",
      summary: `Mark ${ref} as a no-show, as the ${as}. Nothing is refunded: the host keeps the ${eur(heldCents)} paid and not refunded, tourist tax included. ${IRREVERSIBLE}`,
      run: (c) => adminMarkNoShow(bookingId, as, c),
    }));

  const askEarlyDeparture = () =>
    confirm(async () => {
      const p = await adminPreviewRefund(bookingId, null, as, date);
      return {
        action: "booking.early_departure",
        summary: `Record that the guest left ${ref} after the night of ${date}, as the ${as}. ${refundLine(p?.totalCents)} The guest gets an email about the refund. ${IRREVERSIBLE}`,
        run: (c) => adminRecordEarlyDeparture(bookingId, as, date, c),
      };
    });

  const askGoodwill = () =>
    confirm(async () => ({
      action: "booking.goodwill_refund",
      summary: `Refund ${eur(goodwillCents!)} to ${guestName} on ${ref}, as goodwill from the host. The guest gets an email about the refund. ${IRREVERSIBLE}`,
      run: (c) => adminGoodwillRefund(bookingId, amount, c),
    }));

  const askRetry = () =>
    confirm(async () => ({
      action: "booking.retry_refunds",
      summary: `Send ${openRefunds.count === 1 ? "the 1 open refund" : `the ${openRefunds.count} open refunds`} of ${eur(openRefunds.cents)} in total to ${guestName} on ${ref} through Stripe again. The guest gets an email about each refund. ${IRREVERSIBLE}`,
      run: (c) => adminRetryRefunds(bookingId, c),
    }));

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-center gap-2 text-sm">
        <span>Act as</span>
        {(["guest", "host"] as const).map((v) => (
          <Button key={v} size="sm" variant={as === v ? "default" : "outline"} onClick={() => setAs(v)}>
            {v}
          </Button>
        ))}
      </div>
      {!allowed.actor ? (
        <p className="text-sm text-muted-foreground">
          {as === "host"
            ? "No host user on this property, so host actions are unavailable."
            : "No guest user on this booking, so guest actions are unavailable."}
        </p>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Cancel rooms</h3>
        <div className="space-y-1">
          {active.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(r.id)}
                disabled={!can("cancel")}
                onCheckedChange={(c) =>
                  setSelected((s) => (c === true ? [...s, r.id] : s.filter((x) => x !== r.id)))
                }
              />
              {r.name} <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!can("cancel")}
            onClick={doPreview}
          >
            Preview refund
          </Button>
          <Button size="sm" variant="destructive" disabled={!can("cancel")} onClick={askCancel}>
            Cancel selected
          </Button>
        </div>
        {preview === "none" ? (
          <p className="text-sm text-muted-foreground">No preview available.</p>
        ) : preview ? (
          <div className="text-sm">
            Guest-cancellation refund preview: total {eur(preview.totalCents)}
            <ul>
              {preview.perRoom.map((p) => (
                <li key={p.reservationId}>
                  <span className="font-mono text-xs">{p.reservationId.slice(0, 8)}</span>{" "}
                  {eur(p.refund.totalCents)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!can("mark_checked_in")} onClick={() => perform(() => adminMarkCheckedIn(bookingId, as))}>
          Check in
        </Button>
        <Button size="sm" variant="outline" disabled={!can("mark_no_show")} onClick={askNoShow}>
          No-show
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm">Early departure, last night stayed</span>
        <Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          disabled={!can("record_early_departure") || !date}
          onClick={askEarlyDeparture}
        >
          Record early departure
        </Button>
      </div>

      {as === "host" ? (
        <div className="flex items-center gap-2">
          <span className="text-sm">Goodwill refund (EUR)</span>
          <Input className="w-32" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button
            size="sm"
            variant="outline"
            disabled={!can("goodwill_refund") || goodwillCents === null}
            onClick={askGoodwill}
          >
            Issue goodwill refund
          </Button>
          {amount !== "" && goodwillCents === null ? (
            <span className="text-xs text-destructive">Not an amount in euros</span>
          ) : null}
        </div>
      ) : null}

      <div>
        <Button size="sm" variant="outline" disabled={pending || openRefunds.count === 0} onClick={askRetry}>
          Retry refunds
        </Button>
      </div>

      {ask ? (
        <DangerousDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsk(null);
          }}
          action={ask.action}
          targetId={bookingId}
          summary={ask.summary}
          onConfirm={async (reason, stepUpToken) => {
            const answer = await ask.run({ reason, stepUpToken });
            if (!answer.ok) return answer.message;
            setFailure(null);
            setResult(answer.value);
            setPreview(undefined);
            setSelected([]);
            return null;
          }}
        />
      ) : null}

      {failure ? (
        <div className="text-sm text-destructive" role="alert">
          {failure}
        </div>
      ) : null}
      {result ? (
        <div className="text-sm" role="status">
          {result.ok ? (
            <>
              ok
              {result.refunds.length === 0 ? " (no refunds)" : null}
              <ul>
                {result.refunds.map((r, i) => (
                  <li key={i}>
                    {r.reservationId?.slice(0, 8) ?? "booking"} {eur(r.amountCents)} {r.status}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <span className="text-destructive">{result.error}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
