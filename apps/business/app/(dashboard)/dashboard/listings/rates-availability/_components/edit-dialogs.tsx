"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  clearRestrictions,
  createRatePlan,
  setAvailability,
  setRestriction,
  type ActionResult,
} from "../_lib/actions";
import type { AriGridData, EditPrefill, RoomTypeRow } from "../_lib/types";

/**
 * The three bulk-edit modals, plus the reopen path off the detail panel.
 *
 * Every one follows the same shape: pick a room type (and rate plan where it
 * applies), pick a date range, set a value, apply across the range. That is
 * what hosts actually do — per-cell editing is a refinement, not the flow —
 * and it keeps all mutation in one place instead of scattered through the
 * grid.
 */

export type DialogKind =
  | "availability"
  | "restrictions"
  | "rate-plan"
  | "reopen";

interface DialogState {
  kind: DialogKind;
  prefill: EditPrefill;
}

// ─────────────────────────────────────────────
// Shared form scaffolding
// ─────────────────────────────────────────────

function useAction(onDone: () => void) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (action: () => Promise<ActionResult>) => {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (result.ok) onDone();
      else setError(result.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return { pending, error, run };
}

function DateRangeFields({
  startDate,
  endDate,
  onChange,
}: {
  startDate: string;
  endDate: string;
  onChange: (next: { startDate: string; endDate: string }) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="ari-start">From</Label>
        <Input
          id="ari-start"
          type="date"
          value={startDate}
          onChange={(e) => onChange({ startDate: e.target.value, endDate })}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ari-end">To</Label>
        <Input
          id="ari-end"
          type="date"
          value={endDate}
          min={startDate}
          onChange={(e) => onChange({ startDate, endDate: e.target.value })}
          required
        />
      </div>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-(--red-9) text-sm">
      {message}
    </p>
  );
}

function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}

/** Numeric input that models "unset" as an empty string rather than 0. */
function useNullableNumber(initial: number | null = null) {
  const [value, setValue] = React.useState(
    initial === null ? "" : String(initial),
  );
  const parsed = value.trim() === "" ? null : Number(value);
  return {
    value,
    setValue,
    parsed: parsed === null || Number.isNaN(parsed) ? null : parsed,
  };
}

// ─────────────────────────────────────────────
// Edit availability
// ─────────────────────────────────────────────

function EditAvailabilityDialog({
  rooms,
  prefill,
  onDone,
}: {
  rooms: RoomTypeRow[];
  prefill: EditPrefill;
  onDone: () => void;
}) {
  const [roomId, setRoomId] = React.useState(prefill.roomId ?? rooms[0]?.id ?? "");
  const [range, setRange] = React.useState({
    startDate: prefill.startDate ?? "",
    endDate: prefill.endDate ?? prefill.startDate ?? "",
  });
  const override = useNullableNumber();
  const totalRooms = useNullableNumber();
  const [blocked, setBlocked] = React.useState("0");
  const [note, setNote] = React.useState("");
  const { pending, error, run } = useAction(onDone);

  const room = rooms.find((r) => r.id === roomId);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(() =>
          setAvailability({
            roomId,
            startDate: range.startDate,
            endDate: range.endDate,
            availableOverride: override.parsed,
            blockedRooms: Number(blocked) || 0,
            totalRooms: totalRooms.parsed,
            note: note.trim() === "" ? null : note.trim(),
          }),
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit availability</DialogTitle>
        <DialogDescription>
          Availability belongs to the room type. Changes here apply to every
          rate plan on it.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="ari-room">Room type</Label>
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger id="ari-room" className="w-full">
              <SelectValue placeholder="Select a room type" />
            </SelectTrigger>
            <SelectContent>
              {rooms.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name} · {r.totalUnits} unit{r.totalUnits === 1 ? "" : "s"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DateRangeFields {...range} onChange={setRange} />

        <Separator />

        <div className="space-y-1.5">
          <Label htmlFor="ari-blocked">Blocked units</Label>
          <Input
            id="ari-blocked"
            type="number"
            min={0}
            max={room?.totalUnits}
            value={blocked}
            onChange={(e) => setBlocked(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Units held back for maintenance or owner use. Subtracted from the
            computed baseline.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ari-override">Availability override</Label>
          <Input
            id="ari-override"
            type="number"
            min={0}
            placeholder="Leave empty to use the computed number"
            value={override.value}
            onChange={(e) => override.setValue(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            An explicit number overrides units minus bookings and blocks
            entirely. Clearing it restores the computed baseline.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ari-total">Capacity override</Label>
          <Input
            id="ari-total"
            type="number"
            min={0}
            placeholder={
              room ? `Defaults to ${room.totalUnits}` : "Defaults to room total"
            }
            value={totalRooms.value}
            onChange={(e) => totalRooms.setValue(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ari-note">Note</Label>
          <Input
            id="ari-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional — shown in the detail panel"
          />
        </div>

        <FormError message={error} />
      </div>

      <DialogFooter>
        <SubmitButton pending={pending}>Apply to range</SubmitButton>
      </DialogFooter>
    </form>
  );
}

// ─────────────────────────────────────────────
// Edit restrictions
// ─────────────────────────────────────────────

function EditRestrictionsDialog({
  rooms,
  prefill,
  onDone,
}: {
  rooms: RoomTypeRow[];
  prefill: EditPrefill;
  onDone: () => void;
}) {
  const allPlans = rooms.flatMap((room) =>
    room.ratePlans.map((plan) => ({ room, plan })),
  );
  const [ratePlanId, setRatePlanId] = React.useState(
    prefill.ratePlanId ?? allPlans[0]?.plan.id ?? "",
  );
  const [range, setRange] = React.useState({
    startDate: prefill.startDate ?? "",
    endDate: prefill.endDate ?? prefill.startDate ?? "",
  });
  const [isClosed, setIsClosed] = React.useState(false);
  const [cta, setCta] = React.useState(false);
  const [ctd, setCtd] = React.useState(false);
  const minStay = useNullableNumber();
  const maxStay = useNullableNumber();
  const [note, setNote] = React.useState("");
  const { pending, error, run } = useAction(onDone);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(() =>
          setRestriction({
            ratePlanId,
            startDate: range.startDate,
            endDate: range.endDate,
            isClosed,
            minStay: minStay.parsed,
            maxStay: maxStay.parsed,
            closedToArrival: cta,
            closedToDeparture: ctd,
            note: note.trim() === "" ? null : note.trim(),
          }),
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit restrictions</DialogTitle>
        <DialogDescription>
          Restrictions apply to one rate plan. To make a room type unsellable
          across all its plans, edit availability instead.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="ari-plan">Rate plan</Label>
          <Select value={ratePlanId} onValueChange={setRatePlanId}>
            <SelectTrigger id="ari-plan" className="w-full">
              <SelectValue placeholder="Select a rate plan" />
            </SelectTrigger>
            <SelectContent>
              {allPlans.map(({ room, plan }) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {room.name} · {plan.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DateRangeFields {...range} onChange={setRange} />

        <Separator />

        <div className="flex items-start gap-3">
          <Checkbox
            id="ari-closed"
            checked={isClosed}
            onCheckedChange={(v) => setIsClosed(v === true)}
          />
          <div className="space-y-0.5">
            <Label htmlFor="ari-closed">Close this rate plan</Label>
            <p className="text-muted-foreground text-xs">
              Makes it unbookable for the range even when rooms are available.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ari-min">Minimum stay</Label>
            <Input
              id="ari-min"
              type="number"
              min={1}
              placeholder="Plan default"
              value={minStay.value}
              onChange={(e) => minStay.setValue(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ari-max">Maximum stay</Label>
            <Input
              id="ari-max"
              type="number"
              min={1}
              placeholder="No maximum"
              value={maxStay.value}
              onChange={(e) => maxStay.setValue(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Checkbox
            id="ari-cta"
            checked={cta}
            onCheckedChange={(v) => setCta(v === true)}
          />
          <Label htmlFor="ari-cta">Closed to arrival</Label>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox
            id="ari-ctd"
            checked={ctd}
            onCheckedChange={(v) => setCtd(v === true)}
          />
          <Label htmlFor="ari-ctd">Closed to departure</Label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ari-rnote">Note</Label>
          <Input
            id="ari-rnote"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional — shown in the detail panel"
          />
        </div>

        <FormError message={error} />
      </div>

      <DialogFooter>
        <SubmitButton pending={pending}>Apply to range</SubmitButton>
      </DialogFooter>
    </form>
  );
}

// ─────────────────────────────────────────────
// Reopen (from the detail panel's Closed bar)
// ─────────────────────────────────────────────

function ReopenDialog({
  rooms,
  prefill,
  onDone,
}: {
  rooms: RoomTypeRow[];
  prefill: EditPrefill;
  onDone: () => void;
}) {
  const [range, setRange] = React.useState({
    startDate: prefill.startDate ?? "",
    endDate: prefill.endDate ?? prefill.startDate ?? "",
  });
  const { pending, error, run } = useAction(onDone);
  const ratePlanId = prefill.ratePlanId ?? "";
  const plan = rooms
    .flatMap((r) => r.ratePlans)
    .find((p) => p.id === ratePlanId);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(() =>
          clearRestrictions({
            ratePlanId,
            startDate: range.startDate,
            endDate: range.endDate,
            scope: "closures",
          }),
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Reopen {plan?.name ?? "rate plan"}</DialogTitle>
        <DialogDescription>
          Lifts closures overlapping this range. Stay restrictions stay in
          place — clear those separately if you want them gone too.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <DateRangeFields {...range} onChange={setRange} />
        <FormError message={error} />
      </div>

      <DialogFooter>
        <SubmitButton pending={pending}>Reopen dates</SubmitButton>
      </DialogFooter>
    </form>
  );
}

// ─────────────────────────────────────────────
// Add rate plan
// ─────────────────────────────────────────────

function AddRatePlanDialog({
  rooms,
  currency,
  prefill,
  onDone,
}: {
  rooms: RoomTypeRow[];
  currency: string;
  prefill: EditPrefill;
  onDone: () => void;
}) {
  const [roomId, setRoomId] = React.useState(prefill.roomId ?? rooms[0]?.id ?? "");
  const [name, setName] = React.useState("");
  const [bar, setBar] = React.useState("");
  const [refundable, setRefundable] = React.useState(true);
  const [policy, setPolicy] = React.useState("");
  const [minStay, setMinStay] = React.useState("1");
  const maxStay = useNullableNumber();
  const { pending, error, run } = useAction(onDone);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(() =>
          createRatePlan({
            roomId,
            name: name.trim(),
            bar: Number(bar) || 0,
            currency,
            isRefundable: refundable,
            cancellationPolicy: policy.trim() === "" ? null : policy.trim(),
            minStay: Number(minStay) || 1,
            maxStay: maxStay.parsed,
          }),
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Add rate plan</DialogTitle>
        <DialogDescription>
          A new rate plan draws from its room type&apos;s existing inventory —
          it does not add units.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="ari-plan-room">Room type</Label>
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger id="ari-plan-room" className="w-full">
              <SelectValue placeholder="Select a room type" />
            </SelectTrigger>
            <SelectContent>
              {rooms.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ari-plan-name">Name</Label>
          <Input
            id="ari-plan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Non-refundable"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ari-plan-bar">Base rate ({currency})</Label>
          <Input
            id="ari-plan-bar"
            type="number"
            min={0}
            value={bar}
            onChange={(e) => setBar(e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ari-plan-min">Minimum stay</Label>
            <Input
              id="ari-plan-min"
              type="number"
              min={1}
              value={minStay}
              onChange={(e) => setMinStay(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ari-plan-max">Maximum stay</Label>
            <Input
              id="ari-plan-max"
              type="number"
              min={1}
              placeholder="No maximum"
              value={maxStay.value}
              onChange={(e) => maxStay.setValue(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Checkbox
            id="ari-plan-refundable"
            checked={refundable}
            onCheckedChange={(v) => setRefundable(v === true)}
          />
          <Label htmlFor="ari-plan-refundable">Refundable</Label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ari-plan-policy">Cancellation policy</Label>
          <Input
            id="ari-plan-policy"
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <FormError message={error} />
      </div>

      <DialogFooter>
        <SubmitButton pending={pending}>Create rate plan</SubmitButton>
      </DialogFooter>
    </form>
  );
}

// ─────────────────────────────────────────────
// Host
// ─────────────────────────────────────────────

export function AriEditDialogs({
  state,
  data,
  onClose,
}: {
  state: DialogState | null;
  data: AriGridData;
  onClose: () => void;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {state?.kind === "availability" && (
          <EditAvailabilityDialog
            rooms={data.rooms}
            prefill={state.prefill}
            onDone={onClose}
          />
        )}
        {state?.kind === "restrictions" && (
          <EditRestrictionsDialog
            rooms={data.rooms}
            prefill={state.prefill}
            onDone={onClose}
          />
        )}
        {state?.kind === "reopen" && (
          <ReopenDialog
            rooms={data.rooms}
            prefill={state.prefill}
            onDone={onClose}
          />
        )}
        {state?.kind === "rate-plan" && (
          <AddRatePlanDialog
            rooms={data.rooms}
            currency={data.currency}
            prefill={state.prefill}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export type { DialogState };
