"use client";

import { useState, useTransition } from "react";
import type { BookingAction } from "@openbookings/pricing";
import type { LifecycleResult } from "@openbookings/db/booking-lifecycle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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

const eur = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" });

export function RealActionsPanel({
  bookingId,
  rooms,
  initial,
}: {
  bookingId: string;
  rooms: { id: string; name: string; cancelled: boolean }[];
  initial: Record<ActAs, Allowed>;
}) {
  const [as, setAs] = useState<ActAs>("guest");
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | "none">();
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<LifecycleResult | null>(null);
  const [pending, start] = useTransition();

  const allowed = initial[as];
  const can = (a: BookingAction) => allowed.actor && !pending && allowed.actions.includes(a);
  const ids = selected.length > 0 ? selected : null;
  const [failure, setFailure] = useState<string | null>(null);
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
          {rooms
            .filter((r) => !r.cancelled)
            .map((r) => (
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
          <Button
            size="sm"
            variant="destructive"
            disabled={!can("cancel")}
            onClick={() => perform(() => adminCancelRooms(bookingId, as, ids))}
          >
            Cancel selected
          </Button>
        </div>
        {preview === "none" ? (
          <p className="text-sm text-muted-foreground">No preview available.</p>
        ) : preview ? (
          <div className="text-sm">
            Guest-cancellation refund preview: total {eur.format(preview.total)}
            <ul>
              {preview.perRoom.map((p) => (
                <li key={p.reservationId}>
                  <span className="font-mono text-xs">{p.reservationId.slice(0, 8)}</span>{" "}
                  {eur.format(Number(p.refund.total))}
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
        <Button size="sm" variant="outline" disabled={!can("mark_no_show")} onClick={() => perform(() => adminMarkNoShow(bookingId, as))}>
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
          onClick={() => perform(() => adminRecordEarlyDeparture(bookingId, as, date))}
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
            disabled={!can("goodwill_refund") || amount === ""}
            onClick={() => perform(() => adminGoodwillRefund(bookingId, Number(amount)))}
          >
            Issue goodwill refund
          </Button>
        </div>
      ) : null}

      <div>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => perform(() => adminRetryRefunds(bookingId))}>
          Retry refunds
        </Button>
      </div>

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
                    {r.reservationId?.slice(0, 8) ?? "booking"} {eur.format(r.amount)} {r.status}
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
