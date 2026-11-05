"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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

export function ForcedPanel({
  bookingId,
  status,
  rooms,
  refunds,
}: {
  bookingId: string;
  status: string;
  rooms: { id: string; name: string; cancelled: boolean }[];
  refunds: { id: string; reason: string; amount: number; status: string }[];
}) {
  const [newStatus, setNewStatus] = useState(status);
  const [selected, setSelected] = useState<string[]>([]);
  const [refundStatus, setRefundStatus] = useState<Record<string, RefundStatus>>({});
  const [noShow, setNoShow] = useState(false);
  const [early, setEarly] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ForcedResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const perform = (fn: (reason: string | undefined) => Promise<ForcedResult>) =>
    start(async () => {
      setFailure(null);
      try {
        setResult(await fn(reason.trim() || undefined));
      } catch (e) {
        setResult(null);
        setFailure(e instanceof Error ? e.message : String(e));
      }
    });

  return (
    <div className="space-y-4 rounded-md border border-red-500 p-4">
      <h3 className="text-sm font-medium text-red-600">Forced edits — database only, Stripe is not touched</h3>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="forced-reason">
          Reason (optional, used by every button)
        </label>
        <Textarea id="forced-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      </div>

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
          disabled={pending}
          onClick={() => perform((r) => adminForceStatus({ bookingId, status: newStatus, reason: r }))}
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
            disabled={pending || selected.length === 0}
            onClick={() => perform((r) => adminForceUncancelRooms({ bookingId, reservationIds: selected, reason: r }))}
          >
            Un-cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending || selected.length === 0}
            onClick={() => perform((r) => adminForceCancelRooms({ bookingId, reservationIds: selected, reason: r }))}
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
              {f.reason} {f.amount} {f.status}
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => perform((r) => adminForceDeleteRefund({ bookingId, refundId: f.id, reason: r }))}
              >
                Delete
              </Button>
              <select
                className={selectClass}
                value={refundStatus[f.id] ?? "pending"}
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
                disabled={pending}
                onClick={() =>
                  perform((r) =>
                    adminForceRefundStatus({
                      bookingId,
                      refundId: f.id,
                      status: refundStatus[f.id] ?? "pending",
                      reason: r,
                    }),
                  )
                }
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
          disabled={pending || (!noShow && !early)}
          onClick={() => perform((r) => adminForceClearMarkers({ bookingId, noShow, earlyDeparture: early, reason: r }))}
        >
          Clear
        </Button>
      </div>

      {failure ? (
        <div className="text-sm text-destructive" role="alert">
          {failure}
        </div>
      ) : null}
      {result ? (
        <div className="text-sm" role="status">
          {result.ok ? "ok" : <span className="text-destructive">{result.error}</span>}
        </div>
      ) : null}
    </div>
  );
}
