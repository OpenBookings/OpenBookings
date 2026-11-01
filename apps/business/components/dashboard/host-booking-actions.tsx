"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CalendarX2, Gift, LogIn, LogOut, RotateCw } from "lucide-react";
import type { LifecycleResult } from "@openbookings/db/booking-lifecycle";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  hostCancelRooms,
  hostGoodwillRefund,
  hostMarkCheckedIn,
  hostMarkNoShow,
  hostPreviewEarlyDeparture,
  hostRecordEarlyDeparture,
  hostRetryRefunds,
} from "@/lib/reservations/actions";
import type { HostReservation } from "@/lib/reservations/shape";

const euros = new Intl.NumberFormat("en-NL", { style: "currency", currency: "EUR" });
const nightLabel = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const ERRORS: Record<string, string> = {
  not_allowed: "That isn't possible for this booking right now.",
  already_cancelled: "Already cancelled.",
  not_found: "Booking not found.",
  nothing_to_refund: "There is nothing left to refund on this booking.",
};
const REFUND_FAILED =
  "Done, but the refund didn't go through. Use Retry refund, or contact support if it keeps failing.";

type Pending =
  | { kind: "no_show" }
  | { kind: "cancel"; reservationIds: string[] | null; amount: number; label: string }
  | { kind: "early_departure" }
  | { kind: "goodwill" };

/**
 * The actions a host can take on one booking, offered only when the booking's
 * state allows them (`reservation.actions`, worked out on the server). Every
 * action that moves money, or can't be undone, asks first.
 */
export function HostBookingActions({ reservation }: { reservation: HostReservation }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const can = (a: HostReservation["actions"][number]) => reservation.actions.includes(a);
  const activeRooms = reservation.rooms.filter((r) => !r.cancelledAt);

  async function perform(act: () => Promise<LifecycleResult>, success: string) {
    setBusy(true);
    try {
      const result = await act();
      if (!result.ok) {
        toast.error(ERRORS[result.error] ?? "Something went wrong.");
        return;
      }
      if (result.refunds.some((r) => r.status === "failed")) toast.warning(REFUND_FAILED);
      else toast.success(success);
      setPending(null);
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {can("mark_checked_in") && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => perform(() => hostMarkCheckedIn(reservation.id), "Marked as checked in")}
          >
            <LogIn /> Checked in
          </Button>
        )}
        {can("mark_no_show") && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: "no_show" })}>
            <CalendarX2 /> No-show
          </Button>
        )}
        {can("record_early_departure") && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: "early_departure" })}>
            <LogOut /> Left early
          </Button>
        )}
        {can("goodwill_refund") && reservation.totalAmount > reservation.refundedAmount && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: "goodwill" })}>
            <Gift /> Goodwill refund
          </Button>
        )}
        {reservation.refundIssue && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => perform(() => hostRetryRefunds(reservation.id), "Refund sent")}
          >
            <RotateCw /> Retry refund
          </Button>
        )}
      </div>

      {can("cancel") && (
        <div className="flex flex-wrap gap-2">
          {activeRooms.length > 1 &&
            activeRooms.map((room) => (
              <Button
                key={room.reservationId}
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() =>
                  setPending({ kind: "cancel", reservationIds: [room.reservationId], amount: room.paid, label: room.roomName })
                }
              >
                <Ban /> Cancel {room.roomName}
              </Button>
            ))}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive ml-auto"
            disabled={busy}
            onClick={() =>
              setPending({
                kind: "cancel",
                reservationIds: null,
                amount: activeRooms.reduce((sum, r) => sum + r.paid, 0),
                label: activeRooms.length > 1 ? "all rooms" : "this booking",
              })
            }
          >
            <Ban /> Cancel booking
          </Button>
        </div>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <AlertDialogContent>
          {pending?.kind === "no_show" && (
            <Confirm
              title="Mark as no-show?"
              body="The guest gets no refund, tourist tax included. This can't be undone."
              action="Mark no-show"
              busy={busy}
              onConfirm={() => perform(() => hostMarkNoShow(reservation.id), "Marked as no-show")}
            />
          )}
          {pending?.kind === "cancel" && (
            <Confirm
              title={`Cancel ${pending.label}?`}
              body={`The guest gets a full refund of ${euros.format(pending.amount)} from your Stripe balance. Our commission on it is returned to you.`}
              action="Cancel and refund"
              destructive
              busy={busy}
              onConfirm={() =>
                perform(() => hostCancelRooms(reservation.id, pending.reservationIds), "Cancelled and refunded")
              }
            />
          )}
          {pending?.kind === "early_departure" && (
            <EarlyDeparture reservation={reservation} busy={busy} perform={perform} />
          )}
          {pending?.kind === "goodwill" && <Goodwill reservation={reservation} busy={busy} perform={perform} />}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Confirm(props: {
  title: string;
  body: string;
  action: string;
  destructive?: boolean;
  busy: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{props.title}</AlertDialogTitle>
        <AlertDialogDescription>{props.body}</AlertDialogDescription>
      </AlertDialogHeader>
      {props.children}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={props.busy}>Keep as is</AlertDialogCancel>
        <Button
          variant={props.destructive ? "destructive" : "default"}
          disabled={props.busy || props.disabled}
          onClick={props.onConfirm}
        >
          {props.action}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

type Perform = (act: () => Promise<LifecycleResult>, success: string) => Promise<void>;

function EarlyDeparture({ reservation, busy, perform }: { reservation: HostReservation; busy: boolean; perform: Perform }) {
  // Any night but the last: leaving after the last night is just checking out.
  const nights = reservation.rooms.find((r) => !r.cancelledAt)?.nights.slice(0, -1) ?? [];
  const [lastNight, setLastNight] = React.useState(nights[0] ?? "");
  // Keyed by night, so a stale answer for a previous pick is never shown.
  const [preview, setPreview] = React.useState<{ night: string; total: number } | null>(null);
  const refund = preview?.night === lastNight ? preview.total : null;

  React.useEffect(() => {
    if (!lastNight) return;
    let live = true;
    hostPreviewEarlyDeparture(reservation.id, lastNight).then((p) => {
      if (live) setPreview({ night: lastNight, total: p?.total ?? 0 });
    });
    return () => {
      live = false;
    };
  }, [reservation.id, lastNight]);

  return (
    <Confirm
      title="Guest left early?"
      body="Pick the last night they stayed. The nights after it are refunded by the booking's cancellation policy, and the tourist tax for them in full."
      action={refund === null ? "Record departure" : `Record and refund ${euros.format(refund)}`}
      busy={busy}
      disabled={!lastNight || refund === null}
      onConfirm={() =>
        perform(() => hostRecordEarlyDeparture(reservation.id, lastNight), "Early departure recorded")
      }
    >
      <Select value={lastNight} onValueChange={setLastNight}>
        <SelectTrigger aria-label="Last night stayed">
          <SelectValue placeholder="Last night stayed" />
        </SelectTrigger>
        <SelectContent>
          {nights.map((n) => (
            <SelectItem key={n} value={n}>
              Night of {nightLabel.format(new Date(`${n}T00:00:00Z`))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Confirm>
  );
}

function Goodwill({ reservation, busy, perform }: { reservation: HostReservation; busy: boolean; perform: Perform }) {
  const left = Math.round((reservation.totalAmount - reservation.refundedAmount) * 100) / 100;
  const [amount, setAmount] = React.useState("");
  const value = Number(amount.replace(",", "."));
  const valid = Number.isFinite(value) && value > 0 && value <= left;
  return (
    <Confirm
      title="Goodwill refund"
      body={`Refund the guest an amount of your choosing, from your Stripe balance. Up to ${euros.format(left)} is left to refund.`}
      action={valid ? `Refund ${euros.format(value)}` : "Refund"}
      busy={busy}
      disabled={!valid}
      onConfirm={() => perform(() => hostGoodwillRefund(reservation.id, value), "Refund sent")}
    >
      <Input
        inputMode="decimal"
        placeholder="Amount in €"
        aria-label="Refund amount in euros"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
    </Confirm>
  );
}
