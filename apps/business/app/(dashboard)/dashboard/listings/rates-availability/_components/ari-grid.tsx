"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type {
  AriGridData,
  AriSelection,
  CellRun,
  RatePlanRow,
  RateCell,
  RoomTypeRow,
} from "../_lib/types";
import { buildRuns, openPlanSummary, restrictionLabel } from "../_lib/runs";
import {
  formatAdjustment,
  formatMoney,
  isWeekend,
  modifierLabel,
} from "../_lib/format";
import { CELL_STATE_STYLE, HATCH_STYLE, StatusDot } from "./cell-states";

const COLUMN_WIDTH = 96;
const LABEL_WIDTH = 260;
/** Narrow left band holding the rotated room-type name for a whole group. */
const GUTTER_WIDTH = 34;

/**
 * The ARI grid.
 *
 * Each row is its own CSS grid sharing one column template, rather than every
 * cell living in a single grid. That is what makes spanning bars cheap —
 * a run is just `grid-column: span n` inside its own row — and it keeps
 * collapse from having to renumber anything.
 *
 * Room types are groups: the name lives rotated in a sticky left band next to
 * the rows it owns, so the horizontal scroll never takes the answer to "which
 * room am I looking at?" off screen.
 *
 * Focus is a roving tabindex over the data cells: one tab stop for the whole
 * grid, arrows to move within it. Anything else would make a host tab through
 * 14 columns to reach next week.
 */

interface NavRow {
  key: string;
  index: number;
  render: (rowIndex: number) => React.ReactNode;
}

interface RowGroup {
  room: RoomTypeRow;
  rows: NavRow[];
}

interface AriGridProps {
  data: AriGridData;
  expandedRooms: Set<string>;
  onToggleRoom: (roomId: string) => void;
  onSelect: (selection: AriSelection) => void;
}

export function AriGrid({
  data,
  expandedRooms,
  onToggleRoom,
  onSelect,
}: AriGridProps) {
  const columnCount = data.dates.length;
  const [focus, setFocus] = React.useState({ row: 0, col: 0 });
  const cellRefs = React.useRef(new Map<string, HTMLElement>());
  const shouldFocus = React.useRef(false);
  const today = useToday();

  const registerCell = React.useCallback(
    (rowIndex: number, colIndex: number, node: HTMLElement | null) => {
      const key = `${rowIndex}:${colIndex}`;
      if (node) cellRefs.current.set(key, node);
      else cellRefs.current.delete(key);
    },
    [],
  );

  const gridTemplate = `${LABEL_WIDTH}px repeat(${columnCount}, minmax(${COLUMN_WIDTH}px, 1fr))`;
  const minWidth = GUTTER_WIDTH + LABEL_WIDTH + columnCount * COLUMN_WIDTH;

  // ── Build the row groups; the nav model and the render order come from the
  // same list, so arrow keys can never disagree with what's on screen. ──
  const groups: RowGroup[] = [];
  let rowCount = 0;

  for (const room of data.rooms) {
    const rows: NavRow[] = [];

    rows.push({
      key: `${room.id}:availability`,
      index: rowCount++,
      render: (rowIndex) => (
        <AvailabilityRow
          room={room}
          expanded={expandedRooms.has(room.id)}
          onToggle={() => onToggleRoom(room.id)}
          rowIndex={rowIndex}
          focus={focus}
          onFocusCell={setFocus}
          registerCell={registerCell}
          onSelect={onSelect}
          gridTemplate={gridTemplate}
          dates={data.dates}
        />
      ),
    });

    if (expandedRooms.has(room.id)) {
      for (const plan of room.ratePlans) {
        rows.push({
          key: `${room.id}:${plan.id}`,
          index: rowCount++,
          render: (rowIndex) => (
            <RatePlanRowView
              room={room}
              plan={plan}
              rowIndex={rowIndex}
              focus={focus}
              onFocusCell={setFocus}
              registerCell={registerCell}
              onSelect={onSelect}
              gridTemplate={gridTemplate}
              currency={data.currency}
              stayLength={data.stayLength}
              dates={data.dates}
            />
          ),
        });
      }
    }

    groups.push({ room, rows });
  }

  React.useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    cellRefs.current.get(`${focus.row}:${focus.col}`)?.focus();
  }, [focus]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };

    let next: { row: number; col: number } | null = null;

    if (key in moves) {
      const [dRow, dCol] = moves[key];
      next = {
        row: clamp(focus.row + dRow, 0, rowCount - 1),
        col: clamp(focus.col + dCol, 0, columnCount - 1),
      };
    } else if (key === "Home") {
      next = { row: focus.row, col: 0 };
    } else if (key === "End") {
      next = { row: focus.row, col: columnCount - 1 };
    } else if (key === "PageUp") {
      next = { row: 0, col: focus.col };
    } else if (key === "PageDown") {
      next = { row: rowCount - 1, col: focus.col };
    }

    if (!next) return;
    event.preventDefault();
    shouldFocus.current = true;
    setFocus(next);
  };

  return (
    <div
      className="relative flex-1 overflow-auto rounded-xl border bg-card"
      role="grid"
      aria-label="Availability, rates and restrictions by date"
      aria-rowcount={rowCount + 1}
      aria-colcount={columnCount + 1}
      onKeyDown={handleKeyDown}
    >
      <div style={{ minWidth }}>
        <HeaderRow
          dates={data.dates}
          gridTemplate={gridTemplate}
          today={today}
        />

        {groups.map((group) => (
          <div
            key={group.room.id}
            role="rowgroup"
            className="flex border-b last:border-b-0"
          >
            <GroupGutter
              room={group.room}
              expanded={expandedRooms.has(group.room.id)}
            />
            <div className="relative min-w-0 flex-1">
              <ColumnTint
                dates={data.dates}
                gridTemplate={gridTemplate}
                today={today}
              />
              {group.rows.map((row) => (
                <React.Fragment key={row.key}>
                  {row.render(row.index)}
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}

        {data.rooms.length === 0 && (
          <p className="p-8 text-center text-muted-foreground text-sm">
            No room types match the current filters.
          </p>
        )}
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Today, resolved after mount. Server and client can sit either side of
 * midnight or a timezone, and a column highlighted in one and not the other is
 * a hydration mismatch on the busiest element of the screen.
 */
function useToday() {
  return React.useSyncExternalStore(
    subscribeNever,
    getTodaySnapshot,
    () => null,
  );
}

const subscribeNever = () => () => {};

function getTodaySnapshot() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().split("T")[0];
}

const weekdayFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
});

function parseDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`);
}

// ─────────────────────────────────────────────
// Structure
// ─────────────────────────────────────────────

function HeaderRow({
  dates,
  gridTemplate,
  today,
}: {
  dates: string[];
  gridTemplate: string;
  today: string | null;
}) {
  return (
    <div role="row" className="sticky top-0 z-30 flex border-b bg-card">
      <div
        className="sticky left-0 z-10 shrink-0 bg-card"
        style={{ width: GUTTER_WIDTH }}
      />
      <div
        className="grid min-w-0 flex-1"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div
          className="sticky z-10 bg-card"
          style={{ left: GUTTER_WIDTH }}
          aria-hidden
        />
        {dates.map((date) => {
          const isToday = date === today;
          return (
            <div
              key={date}
              role="columnheader"
              className={cn(
                "px-3 py-2.5",
                isToday && "bg-primary/15",
                !isToday && isWeekend(date) && "bg-(--gray-a2)",
              )}
            >
              <div
                className={cn(
                  "text-[11px] leading-tight",
                  isToday ? "text-primary" : "text-muted-foreground",
                )}
              >
                {weekdayFormatter.format(parseDate(date))}
              </div>
              <div
                className={cn(
                  "font-medium text-sm leading-tight tabular-nums",
                  isToday ? "text-primary" : "text-foreground",
                )}
              >
                {dayFormatter.format(parseDate(date))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The tinted weekend and today columns, painted once per group behind the
 * rows. Doing it here rather than per cell is what lets a rate bar span
 * several columns and still sit on top of an unbroken band of colour.
 */
function ColumnTint({
  dates,
  gridTemplate,
  today,
}: {
  dates: string[];
  gridTemplate: string;
  today: string | null;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 grid"
      style={{ gridTemplateColumns: gridTemplate }}
      aria-hidden
    >
      <div />
      {dates.map((date) => (
        <div
          key={date}
          className={cn(
            date === today
              ? "bg-primary/[0.08]"
              : isWeekend(date)
                ? "bg-(--gray-a1)"
                : undefined,
          )}
        />
      ))}
    </div>
  );
}

/**
 * The band down the left edge of a group, sticky so it survives horizontal
 * scrolling. It carries the room-type name rotated — but only once the group
 * is expanded and tall enough to fit it. A collapsed group is a single row;
 * there the name is on the row label itself and a clipped vertical slice of
 * text would be noise.
 *
 * The label is positioned out of flow so a long name can never stretch the
 * group taller than its rows. `sticky` is already a containing block, so no
 * `relative` is needed — adding one would undo the pinning.
 *
 * The band must be fully opaque: it is pinned over content that scrolls
 * horizontally beneath it, and a translucent fill lets rate bars slide through
 * the room name. The muted tint is painted as its own layer on top of `bg-card`
 * so the band still reads as a gutter rather than another column.
 */
function GroupGutter({ room, expanded }: { room: RoomTypeRow; expanded: boolean }) {
  return (
    <div
      className="sticky left-0 z-20 shrink-0 self-stretch overflow-hidden border-r bg-card"
      style={{ width: GUTTER_WIDTH }}
    >
      <div className="absolute inset-0 bg-muted/40" aria-hidden />
      {expanded && (
        <span
          className="absolute inset-0 flex items-center justify-center rotate-180 whitespace-nowrap text-[11px] text-muted-foreground tracking-wide [writing-mode:vertical-rl]"
          title={room.name}
        >
          {room.name}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Rows
// ─────────────────────────────────────────────

interface RowCommonProps {
  rowIndex: number;
  focus: { row: number; col: number };
  onFocusCell: (next: { row: number; col: number }) => void;
  registerCell: (row: number, col: number, node: HTMLElement | null) => void;
  gridTemplate: string;
  dates: string[];
}

function AvailabilityRow({
  room,
  expanded,
  onToggle,
  onSelect,
  rowIndex,
  focus,
  onFocusCell,
  registerCell,
  gridTemplate,
  dates,
}: RowCommonProps & {
  room: RoomTypeRow;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (selection: AriSelection) => void;
}) {
  const byDate = new Map(room.availability.map((a) => [a.date, a]));

  return (
    <div
      role="row"
      className="relative grid border-b"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <div
        className="sticky z-10 h-12 bg-card"
        style={{ left: GUTTER_WIDTH }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex h-full w-full items-center gap-2 border-r px-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
        >
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
            aria-hidden
          />
          {/* Collapsed, this row stands for the whole room type, so it carries
              the name. Expanded, the name moves to the group band and the row
              says what it actually is. */}
          <span className="truncate font-medium text-sm">
            {expanded ? "Available rooms" : room.name}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {expanded
              ? `${room.totalUnits} unit${room.totalUnits === 1 ? "" : "s"}`
              : openPlanSummary(room)}
          </span>
        </button>
      </div>

      {dates.map((date, colIndex) => {
        const cell = byDate.get(date);
        if (!cell) return <div key={date} role="gridcell" />;
        const soldOut = cell.effective <= 0;

        return (
          <button
            key={date}
            type="button"
            role="gridcell"
            ref={(node) => registerCell(rowIndex, colIndex, node)}
            tabIndex={focus.row === rowIndex && focus.col === colIndex ? 0 : -1}
            onFocus={() => onFocusCell({ row: rowIndex, col: colIndex })}
            onClick={() => onSelect({ kind: "availability", room, cell })}
            aria-label={`${room.name}, ${date}: ${cell.effective} of ${cell.totalUnits} available`}
            className={cn(
              "flex h-12 items-center justify-center border-r text-sm tabular-nums transition-colors last:border-r-0 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
              soldOut
                ? "font-medium text-(--red-9)"
                : cell.effective <= 2
                  ? "text-(--amber-11)"
                  : "text-foreground",
            )}
          >
            {cell.effective}
            {cell.source === "override" && (
              <span
                className="ml-0.5 text-[10px] text-muted-foreground"
                title="Manual override in effect"
                aria-label="manual override"
              >
                ●
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function RatePlanRowView({
  room,
  plan,
  onSelect,
  rowIndex,
  focus,
  onFocusCell,
  registerCell,
  gridTemplate,
  currency,
  stayLength,
}: RowCommonProps & {
  room: RoomTypeRow;
  plan: RatePlanRow;
  currency: string;
  stayLength: number;
  onSelect: (selection: AriSelection) => void;
}) {
  const runs = buildRuns(plan.cells);

  return (
    <div
      role="row"
      className="relative grid border-b last:border-b-0"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <div
        className="sticky z-10 flex h-12 items-center gap-2 border-r bg-card px-3 pl-9"
        style={{ left: GUTTER_WIDTH }}
      >
        <StatusDot status={plan.status} />
        <span className="truncate text-sm">{plan.name}</span>
        {!plan.isRefundable && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground uppercase">
            NR
          </span>
        )}
      </div>

      {runs.map((run) => (
        <RunCell
          key={`${plan.id}:${run.startIndex}`}
          room={room}
          plan={plan}
          run={run}
          rowIndex={rowIndex}
          focus={focus}
          onFocusCell={onFocusCell}
          registerCell={registerCell}
          onSelect={onSelect}
          currency={currency}
          stayLength={stayLength}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Cells
// ─────────────────────────────────────────────

function RunCell({
  room,
  plan,
  run,
  rowIndex,
  focus,
  onFocusCell,
  registerCell,
  onSelect,
  currency,
  stayLength,
}: {
  room: RoomTypeRow;
  plan: RatePlanRow;
  run: CellRun;
  rowIndex: number;
  focus: { row: number; col: number };
  onFocusCell: (next: { row: number; col: number }) => void;
  registerCell: (row: number, col: number, node: HTMLElement | null) => void;
  onSelect: (selection: AriSelection) => void;
  currency: string;
  stayLength: number;
}) {
  const span = run.endIndex - run.startIndex;
  const focused = focus.row === rowIndex && withinRun(focus.col, run);

  // A bar covers several columns but is one element. Registering it under
  // every column it spans is what lets arrow-key focus land on it from any
  // of them instead of falling into a gap.
  const ref = React.useCallback(
    (node: HTMLElement | null) => {
      for (let col = run.startIndex; col < run.endIndex; col++) {
        registerCell(rowIndex, col, node);
      }
    },
    [registerCell, rowIndex, run.startIndex, run.endIndex],
  );

  const commonProps = {
    ref,
    role: "gridcell" as const,
    tabIndex: focused ? 0 : -1,
    onFocus: () =>
      onFocusCell({
        row: rowIndex,
        col: withinRun(focus.col, run) ? focus.col : run.startIndex,
      }),
    onClick: () => onSelect({ kind: "rate", room, plan, run }),
    style: { gridColumn: `span ${span}` },
  };

  if (run.state === "open") {
    const cell = run.cells[0];
    return (
      <HoverCard openDelay={200} closeDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            {...commonProps}
            aria-label={rateCellLabel(plan, cell, currency)}
            className="flex h-12 items-center justify-center border-r text-sm tabular-nums transition-colors last:border-r-0 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
          >
            {cell.price === null ? "—" : formatMoney(cell.price, currency)}
            {cell.stayDiscountPending && (
              <span className="text-muted-foreground" aria-hidden>
                *
              </span>
            )}
          </button>
        </HoverCardTrigger>
        <HoverCardContent align="center" className="w-72">
          <RateHoverSummary
            plan={plan}
            cell={cell}
            currency={currency}
            stayLength={stayLength}
          />
        </HoverCardContent>
      </HoverCard>
    );
  }

  const style = CELL_STATE_STYLE[run.state];
  const Icon = style.icon;
  const label =
    run.state === "restricted" ? restrictionLabel(run.cells[0]) : style.label;

  return (
    <button
      type="button"
      {...commonProps}
      style={{
        ...commonProps.style,
        ...(style.hatch ? HATCH_STYLE : undefined),
      }}
      aria-label={`${plan.name}, ${run.cells[0].date}${
        span > 1 ? ` to ${run.cells[span - 1].date}` : ""
      }: ${label}`}
      className={cn(
        "mx-1 my-1.5 flex items-center gap-1.5 overflow-hidden rounded-md border border-l-[3px] px-2 text-left text-xs shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
        style.className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

function withinRun(col: number, run: CellRun) {
  return col >= run.startIndex && col < run.endIndex;
}

function rateCellLabel(
  plan: RatePlanRow,
  cell: RateCell,
  currency: string,
): string {
  const price = cell.price === null ? "no rate" : formatMoney(cell.price, currency);
  return `${plan.name}, ${cell.date}: ${price}`;
}

/**
 * Condensed modifier summary on hover. Auditing a week of pricing by opening
 * the panel on every cell is too slow — hover answers "why this number?" for
 * scanning, the panel answers it for a decision.
 */
function RateHoverSummary({
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
  const applied = plan.modifiers.filter((m) =>
    cell.appliedModifiers.includes(m.type),
  );

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{plan.name}</span>
        <span className="tabular-nums">
          {cell.price === null ? "—" : formatMoney(cell.price, currency)}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
        <span>{cell.hasOverride ? "Override" : "Base rate"}</span>
        <span className="tabular-nums">
          {formatMoney(cell.basePrice, currency)}
        </span>
      </div>

      {applied.length > 0 ? (
        <ul className="space-y-1 border-t pt-2">
          {applied.map((modifier, index) => (
            <li
              key={`${modifier.type}:${index}`}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="text-muted-foreground">
                {modifierLabel(modifier.type)}
              </span>
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
      ) : (
        <p className="border-t pt-2 text-muted-foreground">
          No modifiers applied.
        </p>
      )}

      {cell.stayDiscountPending && (
        <p className="border-t pt-2 text-muted-foreground">
          Stay-length discounts apply. Showing rates for{" "}
          {stayLength === 1 ? "a 1-night stay" : `a ${stayLength}-night stay`} —
          change the stay length in the toolbar to see adjusted rates.
        </p>
      )}
    </div>
  );
}
