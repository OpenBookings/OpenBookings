"use client";

import * as React from "react";
import { Ban, CalendarCog, Lock, PencilLine, Undo2 } from "lucide-react";
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
  CellState,
  EditPrefill,
  RatePlanRow,
  RateCell,
  RoomTypeRow,
} from "../_lib/types";
import {
  chipLabel,
  reasonPhrase,
  sourceHint,
  sourceLabel,
  UNSELLABLE_PRICE_NOTE,
} from "../_lib/status-copy";
import {
  formatAdjustment,
  formatDateRange,
  formatFullDate,
  formatMoney,
  formatTimestamp,
  modifierLabel,
} from "../_lib/format";
import { CELL_STATE_STYLE } from "./cell-states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DraftEdit } from "../_lib/use-ari-draft";
import type { PriceStep } from "@openbookings/pricing";

/**
 * Explains a number, and stages the one-click changes to it.
 *
 * The split: anything that is a single decision about the dates already on
 * screen — close these, reopen these, price these — stages here, because
 * sending a host to a modal to re-type dates they just clicked is a worse
 * version of what they already did. Anything that needs a form they have to
 * fill in (bulk ranges, weekday patterns, a new rate plan) still routes to a
 * toolbar modal.
 *
 * Nothing here writes. Every button stages into the draft, and the host
 * publishes when the sweep is done.
 */

interface DetailPanelProps {
  selection: AriSelection | null;
  currency: string;
  stayLength: number;
  onClose: () => void;
  onEditAvailability: (prefill: EditPrefill) => void;
  onEditRestrictions: (prefill: EditPrefill) => void;
  onReopen: (prefill: EditPrefill) => void;
  onStage: (edits: DraftEdit[]) => void;
}

export function AriDetailPanel({
  selection,
  currency,
  stayLength,
  onClose,
  onEditAvailability,
  onEditRestrictions,
  onReopen,
  onStage,
}: DetailPanelProps) {
  return (
    /* Non-modal: the grid behind this stays scrollable and clickable, so a
       host can compare one date against its neighbours without closing and
       reopening the sheet on every column. */
    <Sheet
      open={selection !== null}
      onOpenChange={(open) => !open && onClose()}
      modal={false}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-[380px]"
        onInteractOutside={(event) => event.preventDefault()}
      >
        {selection?.kind === "availability" && (
          <AvailabilityDetail
            room={selection.room}
            cell={selection.cell}
            onEditAvailability={onEditAvailability}
            onStage={onStage}
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
            onStage={onStage}
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
  onStage,
}: {
  room: RoomTypeRow;
  cell: AvailabilityCell;
  onEditAvailability: (prefill: EditPrefill) => void;
  onStage: (edits: DraftEdit[]) => void;
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

        {/* The room type's own switch lives here rather than on a rate plan
            row, because that is where the decision belongs: closing a room
            type is one act that every plan under it inherits. */}
        <Button
          variant={cell.closure ? "default" : "outline"}
          className="w-full"
          onClick={() =>
            onStage([
              {
                kind: "roomClosure",
                roomId: room.id,
                date: cell.date,
                closed: !cell.closure,
                note: null,
              },
            ])
          }
        >
          {cell.closure ? (
            <>
              <Undo2 className="size-4" />
              Reopen the room type
            </>
          ) : (
            <>
              <Lock className="size-4" />
              Close the room type
            </>
          )}
        </Button>

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
  onStage,
}: {
  room: RoomTypeRow;
  plan: RatePlanRow;
  run: CellRun;
  currency: string;
  stayLength: number;
  onEditAvailability: (prefill: EditPrefill) => void;
  onEditRestrictions: (prefill: EditPrefill) => void;
  onReopen: (prefill: EditPrefill) => void;
  onStage: (edits: DraftEdit[]) => void;
}) {
  const first = run.cells[0];
  const last = run.cells[run.cells.length - 1];
  const range = { startDate: first.date, endDate: last.date };
  // Staging is per cell, so a bar spanning a week stages seven edits. The
  // publish step folds them back into one range.
  const dates = run.cells.map((cell) => cell.date);

  return (
    <>
      {/* Date first, in small type, then the room. A host opens this sheet
          having just clicked a column, so the date is what confirms they hit
          the one they meant — and the name is what they came to act on. */}
      <SheetHeader className="gap-1 pb-3">
        <SheetDescription className="text-xs">
          {formatDateRange(first.date, last.date)}
        </SheetDescription>
        <SheetTitle className="text-lg">{room.name}</SheetTitle>
        <p className="text-muted-foreground text-sm">
          {plan.name} · {plan.isRefundable ? "Refundable" : "Non-refundable"}
        </p>
        <StatusPill run={run} cell={first} />
      </SheetHeader>

      <Body>
        {/* Always, whatever the state. A closed date still has a rate under
            it, and "what would this have sold for?" is exactly the question a
            host asks before deciding whether to reopen. */}
        <PriceBreakdown
          plan={plan}
          cell={first}
          currency={currency}
          stayLength={stayLength}
        />

        {first.reasons.length > 0 && (
          <>
            <Separator />
            <WhySection cell={first} />
          </>
        )}

        {run.state === "sold_out" && (
          <SoldOutDetail room={room} run={run} />
        )}

        <Separator />

        {/* Prose, not a field list. "1 of 8 left" invites the reading that the
            rate plan holds that 1; the sentence is the only way to say the
            pool is shared without the host having to infer it. */}
        <Section title="Availability">
          <p className="text-sm">
            {first.available === 0
              ? "No rooms left on this room type."
              : `${first.available} of ${room.totalUnits} room${
                  room.totalUnits === 1 ? "" : "s"
                } left, shared across every rate plan on ${room.name}.`}
          </p>
          <p className="text-muted-foreground text-sm">
            Minimum stay {first.minStay} night
            {first.minStay === 1 ? "" : "s"}
            {first.maxStay !== null && `, maximum ${first.maxStay} nights`}.
            {plan.cancellationPolicy ? ` ${plan.cancellationPolicy}` : ""}
          </p>
        </Section>

      </Body>

      {/* Pinned, because the build-up above scrolls and the decision should
          not scroll away from the evidence for it. */}
      <div className="space-y-2 border-t bg-(--ari-group) p-4">
        {run.state === "sold_out" && (
          <Button
            className="w-full"
            onClick={() =>
              onEditAvailability({ roomId: room.id, ...range })
            }
          >
            <CalendarCog className="size-4" />
            Fix availability
          </Button>
        )}

        {/* Room closures are lifted on the room type, never here. Offering
            "reopen" on a rate plan whose room is shut would stage an edit
            that changes nothing a guest can see. */}
        {run.state === "room_closed" && (
          <Button
            className="w-full"
            onClick={() =>
              onStage(
                dates.map((date) => ({
                  kind: "roomClosure",
                  roomId: room.id,
                  date,
                  closed: false,
                  note: null,
                })),
              )
            }
          >
            <Undo2 className="size-4" />
            Reopen the room type
          </Button>
        )}

        {run.state === "closed" && (
          <Button
            className="w-full"
            onClick={() =>
              onStage(
                dates.map((date) => ({
                  kind: "closure",
                  ratePlanId: plan.id,
                  date,
                  closed: false,
                  note: null,
                })),
              )
            }
          >
            <Undo2 className="size-4" />
            Reopen {dateCount(dates)}
          </Button>
        )}

        {first.bookable && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              onStage(
                dates.map((date) => ({
                  kind: "closure",
                  ratePlanId: plan.id,
                  date,
                  closed: true,
                  note: null,
                })),
              )
            }
          >
            <Ban className="size-4" />
            Close {dateCount(dates)}
          </Button>
        )}

        <StagePriceForm
          plan={plan}
          cell={first}
          dates={dates}
          currency={currency}
          onStage={onStage}
        />

        {/* The buttons above act on the dates on screen. A closure usually
            runs past them — the Why section says how far — and reopening
            only the visible slice would leave the rest shut without saying
            so. This routes to the form that can take the whole range. */}
        {!first.bookable && extendsBeyond(first, dates) && (
          <Button
            variant="ghost"
            className="w-full text-muted-foreground text-xs"
            onClick={() => onReopen({ ratePlanId: plan.id, ...range })}
          >
            This rule runs past these dates — reopen a longer range
          </Button>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={() => onEditRestrictions({ ratePlanId: plan.id, ...range })}
        >
          <PencilLine className="size-4" />
          Edit restrictions
        </Button>
      </div>
    </>
  );
}

/**
 * The one-line verdict, at the top where it answers the question the host
 * clicked to ask.
 *
 * "Bookable · with restriction" rather than just "Restricted", because those
 * say opposite things to someone scanning: one confirms guests can still
 * book, the other suggests they cannot. The distinction between constrained
 * and unsellable is the whole point of the precedence order underneath it.
 */
function StatusPill({ run, cell }: { run: CellRun; cell: RateCell }) {
  if (cell.bookable) {
    const restriction = chipLabel(cell.reasons);
    return (
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-(--ari-bookable-bg) px-2 py-0.5 font-medium text-(--ari-bookable-fg) text-xs">
        {restriction ? `Bookable · ${restriction}` : "Bookable"}
      </span>
    );
  }

  const style = CELL_STATE_STYLE[run.state as Exclude<CellState, "open">];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-xs",
        style.className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {chipLabel(cell.reasons) ?? style.label}
    </span>
  );
}

/**
 * The audit trail — the reason this panel exists.
 *
 * These are the resolver's own steps, in the order it applied them, and the
 * contract is arithmetic rather than narrative: each row's running total is
 * what the one above it plus this row's change comes to, and the last row is
 * the price on the cell. A host who does not believe the number can add the
 * column up and find out where it came from.
 *
 * Modifiers that did not fire are listed underneath rather than mixed in.
 * They are not part of the price, but "why did the weekend uplift not apply?"
 * is a question this panel should still be able to answer.
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
  const fired = new Set(
    cell.trace.map((step) => step.modifier_type).filter(Boolean),
  );
  const notApplied = plan.modifiers
    .filter((modifier) => !fired.has(modifier.type))
    .sort((a, b) => a.sort_order - b.sort_order);

  const total = cell.trace[cell.trace.length - 1]?.result ?? 0;

  return (
    <Section title="Price build-up">
      {cell.trace.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No rate is configured for this date.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {cell.trace.map((step, index) => (
            <li
              key={`${step.label}:${index}`}
              className="flex items-center justify-between gap-4 bg-(--ari-cell) px-3 py-2.5"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-sm">
                  {step.label}
                </span>
                <span className="block truncate text-muted-foreground text-xs">
                  {stepCaption(step, plan, currency)}
                </span>
              </span>
              <span className="shrink-0 text-right text-sm tabular-nums">
                {index === 0 ? (
                  formatMoney(step.result, currency)
                ) : (
                  <span
                    className={
                      step.delta < 0
                        ? "text-(--ari-bookable-fg)"
                        : "text-(--ari-adjusted-fg)"
                    }
                  >
                    {step.delta < 0 ? "−" : "+"}
                    {formatMoney(Math.abs(step.delta), currency)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Separator className="my-2" />

      <Field
        label={
          stayLength === 1
            ? "Guest pays / night"
            : `Guest pays / night (over ${stayLength} nights)`
        }
        value={
          cell.trace.length === 0
            ? "—"
            : formatMoney(round2(total / stayLength), currency)
        }
        emphasis
      />

      {!cell.bookable && (
        <p className="text-muted-foreground text-xs">{UNSELLABLE_PRICE_NOTE}</p>
      )}

      {notApplied.length > 0 && (
        <>
          <Separator className="my-2" />
          <p className="text-muted-foreground text-xs">Did not apply</p>
          <ul className="space-y-1">
            {notApplied.map((modifier, index) => (
              <li
                key={`${modifier.type}:${index}`}
                className="flex items-baseline justify-between gap-4 text-muted-foreground text-sm"
              >
                <span>{modifierLabel(modifier.type)}</span>
                <span className="tabular-nums">
                  {formatAdjustment(
                    modifier.adjustment_type,
                    modifier.adjustment_value,
                    currency,
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

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

/**
 * The small grey line under a step's name: where that step came from.
 *
 * The amount is already on the right, so this is the provenance the number
 * cannot carry — "Parent rate", "Weekend uplift", "replaces the plan rate" —
 * which is what turns a list of figures into an explanation.
 */
function stepCaption(
  step: PriceStep,
  plan: RatePlanRow,
  currency: string,
): string {
  if (step.op === "base") return "Plan rate";
  if (step.op === "set") {
    return `Manual override, replacing the plan rate of ${formatMoney(plan.bar, currency)}`;
  }
  if (step.op === "percent") {
    return `Modifier · ${formatAdjustment("percent", step.value, currency)}`;
  }
  return `Modifier · ${formatAdjustment("flat", step.value, currency)}`;
}

/** The panel prints step totals; dividing one of them must not reintroduce cents. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Every reason on the cell, each naming who is answerable for it.
 *
 * All of them, not just the one the cell is painted with: a host reopening a
 * sold-out date needs to know a min stay is waiting underneath, or they will
 * reopen it and wonder why nothing books.
 */
function WhySection({ cell }: { cell: RateCell }) {
  return (
    <Section title="Why">
      <ul className="space-y-2.5">
        {cell.reasons.map((reason, index) => (
          <li key={`${reason.code}:${index}`} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm">
                {reasonPhrase(reason).replace(/^./, (c: string) => c.toUpperCase())}
              </span>
              <span
                className="shrink-0 rounded-full border px-1.5 py-px text-muted-foreground text-xs"
                title={sourceHint(reason.source)}
              >
                {sourceLabel(reason.source)}
              </span>
            </div>

            {reason.inherited && (
              <p className="text-muted-foreground text-xs">
                Set on the room type, so it applies to every rate plan under it.
              </p>
            )}

            {reason.range && (
              <p className="text-muted-foreground text-xs">
                Applies {formatDateRange(reason.range.start, reason.range.end)}
              </p>
            )}

            {reason.source.kind === "host" && (
              <>
                {reason.source.note && (
                  <p className="text-sm">“{reason.source.note}”</p>
                )}
                <p className="text-muted-foreground text-xs">
                  {sourceLabel(reason.source)}
                  {formatTimestamp(reason.source.at)
                    ? ` · ${formatTimestamp(reason.source.at)}`
                    : ""}
                </p>
              </>
            )}
          </li>
        ))}
      </ul>

      {/* What the restrictions add up to for a guest. The list above says
          which rules are set; this says what someone trying to book would
          actually run into, which is the question behind the question. */}
      {cell.bookable && (
        <p className="text-muted-foreground text-sm">{plainLanguage(cell)}</p>
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

/** "these 3 dates" / "this date" — the buttons say what they will actually touch. */
function dateCount(dates: string[]): string {
  return dates.length === 1 ? "this date" : `these ${dates.length} dates`;
}

/**
 * Set or clear a price override on the selected dates.
 *
 * Staged, not saved — so a host can price a fortnight cell by cell and look at
 * the whole thing before any of it goes live.
 *
 * Clearing is a first-class action rather than "type the BAR back in": the two
 * are different facts. An override equal to the BAR still shadows it, so a
 * later change to the plan's rate would silently not apply to these dates.
 */
function StagePriceForm({
  plan,
  cell,
  dates,
  currency,
  onStage,
}: {
  plan: RatePlanRow;
  cell: RateCell;
  dates: string[];
  currency: string;
  onStage: (edits: DraftEdit[]) => void;
}) {
  const [value, setValue] = React.useState("");

  const stagePrice = (price: number | null) =>
    onStage(
      dates.map((date) => ({
        kind: "price" as const,
        ratePlanId: plan.id,
        date,
        price,
      })),
    );

  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label htmlFor="ari-price" className="text-xs">
        Set price for {dateCount(dates)}
      </Label>
      <div className="flex gap-2">
        <Input
          id="ari-price"
          inputMode="decimal"
          placeholder={String(Math.round(cell.indicativePrice))}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !valid) return;
            event.preventDefault();
            stagePrice(Math.round(parsed));
            setValue("");
          }}
        />
        <Button
          disabled={!valid}
          onClick={() => {
            stagePrice(Math.round(parsed));
            setValue("");
          }}
        >
          Stage
        </Button>
      </div>
      {cell.hasOverride && (
        <Button
          variant="ghost"
          className="w-full justify-start px-2 text-muted-foreground text-xs"
          onClick={() => stagePrice(null)}
        >
          Clear the override and go back to the plan rate of{" "}
          {formatMoney(plan.bar, currency)}
        </Button>
      )}
    </div>
  );
}

/** True when the cell's primary rule covers dates outside the selected run. */
function extendsBeyond(cell: RateCell, dates: string[]): boolean {
  const range = cell.reasons[0]?.range;
  if (!range) return false;
  return range.start < dates[0] || range.end > dates[dates.length - 1];
}
