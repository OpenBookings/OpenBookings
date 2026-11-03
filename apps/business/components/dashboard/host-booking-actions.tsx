"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { Ban, HandCoins, LogIn, LogOut, RotateCw, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  invalid_amount: "Enter an amount greater than zero.",
};
const REFUND_FAILED =
  "Done, but the refund didn't go through. Use Retry refund, or contact support if it keeps failing.";

type Pending = { kind: "no_show" } | { kind: "cancel" } | { kind: "early_departure" } | { kind: "goodwill" };

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

  const canRetry = reservation.refundIssue && reservation.canRetryRefunds;
  const canGoodwill = can("goodwill_refund") && reservation.totalAmount > reservation.refundedAmount;
  // The one thing due now leads: checking the guest in, else a refund that
  // didn't go through. The rest are outline icons; Cancel sits apart.
  const primary = can("mark_checked_in") ? "check_in" : canRetry ? "retry" : null;

  const actions: Array<{ key: string; label: string; icon: React.ReactNode; onClick: () => void }> = [];
  if (can("mark_checked_in")) {
    actions.push({
      key: "check_in",
      label: "Check in",
      icon: <LogIn />,
      onClick: () => perform(() => hostMarkCheckedIn(reservation.id), "Marked as checked in"),
    });
  }
  if (canRetry) {
    actions.push({
      key: "retry",
      label: "Retry refund",
      icon: <RotateCw />,
      onClick: () => perform(() => hostRetryRefunds(reservation.id), "Refund sent"),
    });
  }
  if (can("mark_no_show")) {
    actions.push({ key: "no_show", label: "Mark as no-show", icon: <UserX />, onClick: () => setPending({ kind: "no_show" }) });
  }
  if (can("record_early_departure")) {
    actions.push({ key: "early", label: "Guest left early", icon: <LogOut />, onClick: () => setPending({ kind: "early_departure" }) });
  }
  if (canGoodwill) {
    actions.push({ key: "goodwill", label: "Refund booking", icon: <HandCoins />, onClick: () => setPending({ kind: "goodwill" }) });
  }
  // The primary one goes first.
  actions.sort((x, y) => Number(y.key === primary) - Number(x.key === primary));

  if (actions.length === 0 && !can("cancel")) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex w-full items-center gap-2">
        {actions.map((action) => (
          <IconAction
            key={action.key}
            label={action.label}
            variant={action.key === primary ? "default" : "outline"}
            disabled={busy}
            onClick={action.onClick}
          >
            {action.icon}
          </IconAction>
        ))}
        {can("cancel") && (
          <IconAction
            label="Cancel booking"
            variant="outline"
            className="ml-auto border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy}
            onClick={() => setPending({ kind: "cancel" })}
          >
            <Ban />
          </IconAction>
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
            {pending?.kind === "cancel" && <CancelRooms reservation={reservation} busy={busy} perform={perform} />}
            {pending?.kind === "early_departure" && (
              <EarlyDeparture reservation={reservation} busy={busy} perform={perform} />
            )}
            {pending?.kind === "goodwill" && <Goodwill reservation={reservation} busy={busy} perform={perform} />}
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

/** An icon-only action: the label is its tooltip and its accessible name. */
function IconAction({
  label,
  children,
  ...props
}: { label: string; children: React.ReactNode } & Omit<React.ComponentProps<typeof Button>, "size" | "aria-label">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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

/**
 * Which rooms to cancel. A host cancellation always refunds the guest in
 * full, so each room shows what it cost; the total is capped at what is
 * left to refund (a goodwill refund may already have gone out).
 */
function CancelRooms({ reservation, busy, perform }: { reservation: HostReservation; busy: boolean; perform: Perform }) {
  const active = reservation.rooms.filter((r) => !r.cancelledAt);
  const [chosen, setChosen] = React.useState<string[]>(() => active.map((r) => r.reservationId));
  const left = Math.max(0, reservation.totalAmount - reservation.refundedAmount);
  const picked = active.filter((r) => chosen.includes(r.reservationId));
  const refund = Math.min(left, Math.round(picked.reduce((sum, r) => sum + r.paid, 0) * 100) / 100);
  const everything = picked.length === active.length;
  const several = active.length > 1;

  const action =
    picked.length === 0
      ? "Pick a room"
      : everything
        ? `Cancel ${several ? "all rooms" : "booking"} and refund ${euros.format(refund)}`
        : `Cancel ${picked.length} ${picked.length === 1 ? "room" : "rooms"} and refund ${euros.format(refund)}`;

  return (
    <Confirm
      title={several ? "Cancel rooms" : "Cancel this booking?"}
      body={
        several
          ? "Pick the rooms to cancel. The guest gets a full refund for each, from your Stripe balance. Our commission on it is returned to you."
          : "The guest gets a full refund from your Stripe balance. Our commission on it is returned to you."
      }
      action={action}
      destructive
      busy={busy}
      disabled={picked.length === 0}
      onConfirm={() =>
        perform(
          () => hostCancelRooms(reservation.id, everything ? null : picked.map((r) => r.reservationId)),
          "Cancelled and refunded",
        )
      }
    >
      <div className="flex flex-col gap-2">
        {several
          ? active.map((room) => {
              const id = `cancel-${room.reservationId}`;
              const checked = chosen.includes(room.reservationId);
              return (
                <label
                  key={room.reservationId}
                  htmlFor={id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm has-[[data-state=checked]]:border-input"
                >
                  <Checkbox
                    id={id}
                    checked={checked}
                    disabled={busy}
                    onCheckedChange={(value) =>
                      setChosen((current) =>
                        value === true
                          ? [...new Set([...current, room.reservationId])]
                          : current.filter((c) => c !== room.reservationId),
                      )
                    }
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{room.roomName}</span>
                    <span className="text-xs text-muted-foreground">{room.tierLabel}</span>
                  </span>
                  <span className="tabular-nums">{euros.format(room.paid)}</span>
                </label>
              );
            })
          : null}
        <div className="flex items-baseline justify-between rounded-md bg-muted px-3 py-2.5 text-sm font-semibold">
          <span>Guest gets back</span>
          <span className="tabular-nums">{euros.format(refund)}</span>
        </div>
      </div>
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
      title="Refund booking"
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
