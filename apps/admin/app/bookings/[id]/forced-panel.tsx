"use client";

import { useState } from "react";
import { bookingReference } from "@openbookings/db/booking-reference";
import { formatCents } from "@openbookings/pricing/money";
import { DangerousDialog } from "@/components/dangerous-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Confirmation, DangerousAction, DangerousResult } from "@/lib/dangerous-actions";
import {
  adminForceCancelRooms,
  adminForceClearMarkers,
  adminForceDeleteRefund,
  adminForceRefundStatus,
  adminForceStatus,
  adminForceUncancelRooms,
} from "@/lib/forced-edits-actions";
import type { ForcedResult } from "@/lib/forced-edits";

const STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show", "checked_in"];
const REFUND_STATUSES = ["pending", "succeeded", "failed"] as const;
type RefundStatus = (typeof REFUND_STATUSES)[number];

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

const eur = (cents: number) => formatCents(cents, { whole: "always-decimals" });
const DB_ONLY = "Only the database changes: Stripe is not touched and nobody is emailed.";

/** A forced edit waiting for the confirm dialog. */
type Ask = {
  action: DangerousAction;
  /** The booking, or the refund row for refund edits. */
  targetId: string;
  summary: string;
  run: (c: Confirmation) => Promise<DangerousResult<ForcedResult>>;
};

export function ForcedPanel({
  bookingId,
  status,
  rooms,
  refunds,
}: {
  bookingId: string;
  status: string;
  rooms: { id: string; name: string; cancelled: boolean }[];
  refunds: { id: string; reason: string; amountCents: number; status: string }[];
}) {
  const [newStatus, setNewStatus] = useState(status);
  const [selected, setSelected] = useState<string[]>([]);
  const [refundStatus, setRefundStatus] = useState<Record<string, RefundStatus>>({});
  const [noShow, setNoShow] = useState(false);
  const [early, setEarly] = useState(false);
  const [result, setResult] = useState<ForcedResult | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  const ref = bookingReference(bookingId);
  const names = rooms.filter((r) => selected.includes(r.id)).map((r) => r.name).join(", ");
  const cancelsAll = rooms.every((r) => r.cancelled || selected.includes(r.id));
  const refundText = (f: (typeof refunds)[number]) => `the ${f.status} ${f.reason} refund of ${eur(f.amountCents)}`;

  return (
    <div className="space-y-4 rounded-md border border-red-500 p-4">
      <h3 className="text-sm font-medium text-red-600">Forced edits — database only, Stripe is not touched</h3>

      <div className="flex items-center gap-2 text-sm">
        <span>Status</span>
        <select className={selectClass} value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={newStatus === status}
          onClick={() =>
            setAsk({
              action: "booking.force_status",
              targetId: bookingId,
              summary: `Set ${ref} from ${status} to ${newStatus}. ${DB_ONLY}`,
              run: (c) => adminForceStatus({ bookingId, status: newStatus }, c),
            })
          }
        >
          Set
        </Button>
      </div>

      <div className="space-y-2">
        <div className="space-y-1">
          {rooms.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(r.id)}
                onCheckedChange={(c) => setSelected((s) => (c === true ? [...s, r.id] : s.filter((x) => x !== r.id)))}
              />
              {r.name} <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
              {r.cancelled ? <span className="text-xs text-muted-foreground">(cancelled)</span> : null}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={selected.length === 0}
            onClick={() =>
              setAsk({
                action: "booking.force_uncancel",
                targetId: bookingId,
                summary: `Un-cancel ${names} on ${ref}${status === "cancelled" ? ", and set the booking back to confirmed" : ""}. Refunds already made stay made. ${DB_ONLY}`,
                run: (c) => adminForceUncancelRooms({ bookingId, reservationIds: selected }, c),
              })
            }
          >
            Un-cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={selected.length === 0}
            onClick={() =>
              setAsk({
                action: "booking.force_cancel",
                targetId: bookingId,
                summary: `Cancel ${names} on ${ref}${cancelsAll ? ", which cancels the booking" : ""}. Nothing is refunded. ${DB_ONLY}`,
                run: (c) => adminForceCancelRooms({ bookingId, reservationIds: selected }, c),
              })
            }
          >
            Cancel (no refund)
          </Button>
        </div>
      </div>

      {refunds.length > 0 ? (
        <ul className="space-y-1">
          {refunds.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs">{f.id.slice(0, 8)}</span>
              {f.reason} {formatCents(f.amountCents, { whole: "always-decimals" })} {f.status}
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  setAsk({
                    action: "refund.force_delete",
                    targetId: f.id,
                    summary: `Delete ${refundText(f)} from ${ref}. The money is not moved back. ${DB_ONLY} This can't be undone.`,
                    run: (c) => adminForceDeleteRefund({ bookingId, refundId: f.id }, c),
                  })
                }
              >
                Delete
              </Button>
              <select
                className={selectClass}
                value={refundStatus[f.id] ?? (f.status as RefundStatus)}
                onChange={(e) => setRefundStatus((m) => ({ ...m, [f.id]: e.target.value as RefundStatus }))}
              >
                {REFUND_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={(refundStatus[f.id] ?? (f.status as RefundStatus)) === f.status}
                onClick={() => {
                  const to = refundStatus[f.id] ?? (f.status as RefundStatus);
                  setAsk({
                    action: "refund.force_status",
                    targetId: f.id,
                    summary: `Set ${refundText(f)} on ${ref} to ${to}. ${DB_ONLY}`,
                    run: (c) => adminForceRefundStatus({ bookingId, refundId: f.id, status: to }, c),
                  });
                }}
              >
                Set status
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox checked={noShow} onCheckedChange={(c) => setNoShow(c === true)} />
          no-show marker
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={early} onCheckedChange={(c) => setEarly(c === true)} />
          early departure
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!noShow && !early}
          onClick={() =>
            setAsk({
              action: "booking.force_clear_markers",
              targetId: bookingId,
              summary: `Clear the ${[noShow && "no-show", early && "early-departure"].filter(Boolean).join(" and ")} marker on ${ref}. Its status and refunds stay as they are. ${DB_ONLY}`,
              run: (c) => adminForceClearMarkers({ bookingId, noShow, earlyDeparture: early }, c),
            })
          }
        >
          Clear
        </Button>
      </div>

      {ask ? (
        <DangerousDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsk(null);
          }}
          action={ask.action}
          targetId={ask.targetId}
          summary={ask.summary}
          onConfirm={async (reason, stepUpToken) => {
            const answer = await ask.run({ reason, stepUpToken });
            if (!answer.ok) return answer.message;
            setResult(answer.value);
            if (answer.value.ok) setSelected([]);
            return null;
          }}
        />
      ) : null}
      {result ? (
        <div className="text-sm" role="status">
          {result.ok ? "ok" : <span className="text-destructive">{result.error}</span>}
        </div>
      ) : null}
    </div>
  );
}
