"use client";

import * as React from "react";
import { CalendarCog, PencilLine, Undo2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type {
  AriSelection,
  AvailabilityCell,
  CellRun,
  EditPrefill,
  RatePlanRow,
  RateCell,
  RoomTypeRow,
} from "../_lib/types";
import { restrictionLabel } from "../_lib/runs";
import {
  formatAdjustment,
  formatDateRange,
  formatFullDate,
  formatMoney,
  formatTimestamp,
  modifierLabel,
} from "../_lib/format";
import { CELL_STATE_STYLE } from "./cell-states";

/**
 * Inspection and audit only — every mutation leaves through a toolbar modal.
 * Two editing surfaces over the same data is a maintenance trap, so the
 * panel's job stops at explaining a number and routing to the thing that
 * changes it.
 */

interface DetailPanelProps {
  selection: AriSelection | null;
  currency: string;
  stayLength: number;
  onClose: () => void;
  onEditAvailability: (prefill: EditPrefill) => void;
  onEditRestrictions: (prefill: EditPrefill) => void;
  onReopen: (prefill: EditPrefill) => void;
}

export function AriDetailPanel({
  selection,
  currency,
  stayLength,
  onClose,
  onEditAvailability,
  onEditRestrictions,
  onReopen,
}: DetailPanelProps) {
  return (
    <Sheet open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {selection?.kind === "availability" && (
          <AvailabilityDetail
            room={selection.room}
            cell={selection.cell}
            onEditAvailability={onEditAvailability}
          />
        )}
        {selection?.kind === "rate" && (
          <RateDetail
            room={selection.room}
            plan={selection.plan}
            run={selection.run}
            currency={currency}
            stayLength={stayLength}
            onEditAvailability={onEditAvailability}
            onEditRestrictions={onEditRestrictions}
            onReopen={onReopen}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────

function Field({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span
        className={cn(
          "text-right text-sm tabular-nums",
          emphasis ? "font-semibold" : "font-medium",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-6">{children}</div>
  );
}

// ─────────────────────────────────────────────
// Availability cell
// ─────────────────────────────────────────────

function AvailabilityDetail({
  room,
  cell,
  onEditAvailability,
}: {
  room: RoomTypeRow;
  cell: AvailabilityCell;
  onEditAvailability: (prefill: EditPrefill) => void;
}) {
  const updatedAt = formatTimestamp(cell.updatedAt);

  return (
    <>
      <SheetHeader>
        <SheetTitle>{room.name}</SheetTitle>
        <SheetDescription>{formatFullDate(cell.date)}</SheetDescription>
      </SheetHeader>

      <Body>
        <Section title="Effective availability">
          <Field
            label="Available"
            value={`${cell.effective} of ${cell.totalUnits}`}
            emphasis
          />
          <p className="text-muted-foreground text-xs">
            {cell.source === "override"
              ? "A manual override is in effect. The computed baseline is being ignored."
              : "Computed from units, bookings and blocks. No manual override is set."}
          </p>
        </Section>

        <Separator />

        <Section title="How this number is reached">
          <Field label="Total units" value={cell.totalUnits} />
          <Field label="Booked" value={`− ${cell.booked}`} />
          <Field label="Blocked" value={`− ${cell.blocked}`} />
          <Separator className="my-2" />
          <Field
            label="Computed baseline"
            value={cell.computed}
            emphasis={cell.source === "computed"}
          />
          <Field
            label="Manual override"
            value={cell.override ?? "Not set"}
            emphasis={cell.source === "override"}
          />
        </Section>

        {(cell.note || updatedAt) && (
          <>
            <Separator />
            <Section title="Last change">
              {updatedAt && <Field label="When" value={updatedAt} />}
              {cell.updatedByName && (
                <Field label="By" value={cell.updatedByName} />
              )}
              {cell.note && (
                <p className="text-muted-foreground text-sm">{cell.note}</p>
              )}
            </Section>
          </>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={() =>
            onEditAvailability({
              roomId: room.id,
              startDate: cell.date,
              endDate: cell.date,
            })
          }
        >
          <CalendarCog className="size-4" />
          Edit availability
        </Button>
      </Body>
    </>
  );
}

// ─────────────────────────────────────────────
// Rate plan cell / bar
// ─────────────────────────────────────────────

function RateDetail({
  room,
  plan,
  run,
  currency,
  stayLength,
  onEditAvailability,
  onEditRestrictions,
  onReopen,
}: {
  room: RoomTypeRow;
  plan: RatePlanRow;
  run: CellRun;
  currency: string;
  stayLength: number;
  onEditAvailability: (prefill: EditPrefill) => void;
  onEditRestrictions: (prefill: EditPrefill) => void;
  onReopen: (prefill: EditPrefill) => void;
}) {
  const first = run.cells[0];
  const last = run.cells[run.cells.length - 1];
  const range = { startDate: first.date, endDate: last.date };

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {plan.name}
          {run.state !== "open" && (
            <StateChip state={run.state} cell={first} />
          )}
        </SheetTitle>
        <SheetDescription>
          {room.name} · {formatDateRange(first.date, last.date)}
        </SheetDescription>
      </SheetHeader>

      <Body>
        {run.state === "open" && (
          <PriceBreakdown
            plan={plan}
            cell={first}
            currency={currency}
            stayLength={stayLength}
          />
        )}

        {run.state === "closed" && <ClosedDetail cell={first} plan={plan} />}

        {run.state === "sold_out" && (
          <SoldOutDetail room={room} run={run} />
        )}

        {run.state === "restricted" && <RestrictionDetail cell={first} />}

        <Separator />

        <Section title="Rate plan">
          <Field
            label="Cancellation"
            value={plan.isRefundable ? "Refundable" : "Non-refundable"}
          />
          {plan.cancellationPolicy && (
            <p className="text-muted-foreground text-sm">
              {plan.cancellationPolicy}
            </p>
          )}
          <Field
            label="Minimum stay"
            value={`${first.minStay} night${first.minStay === 1 ? "" : "s"}`}
          />
          {first.maxStay !== null && (
            <Field label="Maximum stay" value={`${first.maxStay} nights`} />
          )}
          <Field
            label="Availability on this room type"
            value={`${first.available} unit${first.available === 1 ? "" : "s"}`}
          />
        </Section>

        <div className="space-y-2">
          {run.state === "sold_out" ? (
            <Button
              className="w-full"
              onClick={() =>
                onEditAvailability({ roomId: room.id, ...range })
              }
            >
              <CalendarCog className="size-4" />
              Fix availability
            </Button>
          ) : run.state === "closed" ? (
            <Button
              className="w-full"
              onClick={() => onReopen({ ratePlanId: plan.id, ...range })}
            >
              <Undo2 className="size-4" />
              Reopen these dates
            </Button>
          ) : null}

          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              onEditRestrictions({ ratePlanId: plan.id, ...range })
            }
          >
            <PencilLine className="size-4" />
            Edit restrictions
          </Button>
        </div>
      </Body>
    </>
  );
}

function StateChip({
  state,
  cell,
}: {
  state: Exclude<CellRun["state"], "open">;
  cell: RateCell;
}) {
  const style = CELL_STATE_STYLE[state];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-xs",
        style.className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {state === "restricted" ? restrictionLabel(cell) : style.label}
    </span>
  );
}

/**
 * The audit trail — the reason this panel exists. Shows the ordered chain from
 * BAR to final price, so a host can see exactly which rule moved the number
 * rather than guessing.
 */
function PriceBreakdown({
  plan,
  cell,
  currency,
  stayLength,
}: {
  plan: RatePlanRow;
  cell: RateCell;
  currency: string;
  stayLength: number;
}) {
  const appliedSet = new Set(cell.appliedModifiers);
  const ordered = [...plan.modifiers].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <Section title="Price breakdown">
      <Field
        label={cell.hasOverride ? "Rate override" : "Base rate (BAR)"}
        value={formatMoney(cell.basePrice, currency)}
      />
      {cell.hasOverride && (
        <p className="text-muted-foreground text-xs">
          {cell.overrideLabel
            ? `Override “${cell.overrideLabel}” replaces the plan's BAR of ${formatMoney(plan.bar, currency)} for this date.`
            : `An override replaces the plan's BAR of ${formatMoney(plan.bar, currency)} for this date.`}
        </p>
      )}

      <Separator className="my-2" />

      {ordered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No modifiers on this rate plan.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {ordered.map((modifier, index) => {
            const applied = appliedSet.has(modifier.type);
            return (
              <li
                key={`${modifier.type}:${index}`}
                className={cn(
                  "flex items-baseline justify-between gap-4 text-sm",
                  !applied && "opacity-50",
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {modifier.sort_order}
                  </span>
                  <span>{modifierLabel(modifier.type)}</span>
                </span>
                <span className="tabular-nums">
                  {applied
                    ? formatAdjustment(
                        modifier.adjustment_type,
                        modifier.adjustment_value,
                        currency,
                      )
                    : "not applied"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <Separator className="my-2" />

      <Field
        label={`Final price (${stayLength}-night stay, per night)`}
        value={cell.price === null ? "—" : formatMoney(cell.price, currency)}
        emphasis
      />

      {cell.stayDiscountPending && (
        <p className="text-muted-foreground text-xs">
          This plan has a length-of-stay discount that a{" "}
          {stayLength === 1 ? "one" : stayLength}-night stay does not qualify
          for. Raise the stay length in the toolbar to see the discounted rate.
        </p>
      )}
    </Section>
  );
}

function ClosedDetail({
  cell,
  plan,
}: {
  cell: RateCell;
  plan: RatePlanRow;
}) {
  const rule = cell.rule;
  return (
    <Section title="Closure">
      <p className="text-sm">
        {plan.name} is closed for these dates. Guests cannot book it even though
        rooms are available — this affects this rate plan only.
      </p>
      {rule && (
        <>
          <Field
            label="Applies to"
            value={formatDateRange(rule.startDate, rule.endDate)}
          />
          <Field label="Closed by" value={rule.createdByName ?? "Unknown"} />
          <Field
            label="Closed on"
            value={formatTimestamp(rule.createdAt) ?? "—"}
          />
          {rule.note && (
            <p className="text-muted-foreground text-sm">{rule.note}</p>
          )}
        </>
      )}
    </Section>
  );
}

function SoldOutDetail({
  room,
  run,
}: {
  room: RoomTypeRow;
  run: CellRun;
}) {
  const dates = new Set(run.cells.map((c) => c.date));
  const availability = room.availability.filter((a) => dates.has(a.date));
  const planCount = room.ratePlans.length;

  return (
    <Section title="Sold out">
      <p className="text-sm">
        {room.name} has no units left on these dates, so every rate plan on this
        room type is unsellable — all {planCount} of them, not just this one.
        Availability belongs to the room type; the rate plans share one pool.
      </p>

      <Separator className="my-2" />

      {availability.map((cell) => (
        <div key={cell.date} className="space-y-0.5">
          <Field
            label={formatFullDate(cell.date)}
            value={`${cell.effective} of ${cell.totalUnits}`}
          />
          <p className="text-muted-foreground text-xs">
            {cell.booked} booked, {cell.blocked} blocked
            {cell.source === "override" && " · manual override in effect"}
          </p>
        </div>
      ))}
    </Section>
  );
}

function RestrictionDetail({ cell }: { cell: RateCell }) {
  const rule = cell.rule;
  return (
    <Section title="Restriction">
      <p className="text-sm">{plainLanguage(cell)}</p>
      {rule && (
        <>
          <Field
            label="Applies to"
            value={formatDateRange(rule.startDate, rule.endDate)}
          />
          <Field label="Set by" value={rule.createdByName ?? "Unknown"} />
          <Field label="Set on" value={formatTimestamp(rule.createdAt) ?? "—"} />
          {rule.note && (
            <p className="text-muted-foreground text-sm">{rule.note}</p>
          )}
        </>
      )}
    </Section>
  );
}

/** Spell out what the rule does to bookability — the rule name alone doesn't. */
function plainLanguage(cell: RateCell): string {
  const clauses: string[] = [];

  if (cell.minStay > 1) {
    clauses.push(
      `guests must book at least ${cell.minStay} nights to include these dates`,
    );
  }
  if (cell.maxStay !== null) {
    clauses.push(`stays covering these dates cannot exceed ${cell.maxStay} nights`);
  }
  if (cell.closedToArrival) {
    clauses.push("guests cannot check in on these dates, but a stay may run through them");
  }
  if (cell.closedToDeparture) {
    clauses.push("guests cannot check out on these dates");
  }

  if (clauses.length === 0) return "This rate plan is bookable without constraints.";
  return `The rate plan is still bookable, but ${clauses.join("; ")}.`;
}
