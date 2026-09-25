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
  AvailabilityCell,
  CellRun,
  RangeSelection,
  RatePlanRow,
  RateCell,
  RoomTypeRow,
} from "../_lib/types";
import { availabilityLevel } from "../_lib/derive";
import type { DraftEdit } from "../_lib/use-ari-draft";
import { buildRuns, openPlanSummary } from "../_lib/runs";
import { adjustmentChip, chipLabel, reasonsPhrase } from "../_lib/status-copy";
import {
  formatAdjustment,
  formatDateRange,
  formatFullDate,
  formatMoney,
  isWeekend,
  modifierLabel,
} from "../_lib/format";
import {
  CELL_STATE_STYLE,
  Chip,
  GridLegend,
  HATCH_STYLE,
  PolicyTag,
  StatusDot,
} from "./cell-states";

/** The sticky left rail carrying room type and rate plan names. */
const RAIL_WIDTH = 240;
const COLUMN_MIN = 88;
/** Gap between cells. A spanning bar covers the gaps it crosses. */
const GAP = 4;

/**
 * The ARI grid.
 *
 * A room type is a card, not a band of rows: its availability and the rate
 * plans drawing on that availability are one object, and the card is what says
 * so. Horizontal scrolling moves the dates under a rail that stays put, so
 * "which room am I looking at?" never scrolls away.
 *
 * Each row is its own CSS grid sharing one column template rather than every
 * cell living in a single grid. That is what makes spanning bars cheap — a run
 * is just `grid-column: span n` inside its own row — and it keeps collapse
 * from having to renumber anything.
 *
 * Focus is a roving tabindex over the data cells: one tab stop for the whole
 * grid, arrows to move within it. Anything else would make a host tab through
 * fourteen columns to reach next week.
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

/** Looks up a staged edit for one cell, so the grid can mark it unpublished. */
type DraftEditLookup = (
  kind: DraftEdit["kind"],
  targetId: string,
  date: string,
) => DraftEdit | undefined;

interface AriGridProps {
  data: AriGridData;
  expandedRooms: Set<string>;
  onToggleRoom: (roomId: string) => void;
  onSelect: (selection: AriSelection) => void;
  draftEditFor: DraftEditLookup;
  /** Shift-click on a rate cell. `extend` is true when the host held shift. */
  onRangeSelect: (
    room: RoomTypeRow,
    plan: RatePlanRow,
    colIndex: number,
    extend: boolean,
  ) => void;
  rangeSelection: RangeSelection | null;
  /** What the detail sheet is currently showing, so the grid can mark it. */
  selection: AriSelection | null;
}

/** Shared by every row, so the nav model and the layout cannot disagree. */
interface RowCommonProps {
  rowIndex: number;
  focus: { row: number; col: number };
  onFocusCell: (next: { row: number; col: number }) => void;
  registerCell: (row: number, col: number, node: HTMLElement | null) => void;
  gridTemplate: string;
  dates: string[];
  today: string | null;
}

export function AriGrid({
  data,
  expandedRooms,
  onToggleRoom,
  onSelect,
  draftEditFor,
  onRangeSelect,
  rangeSelection,
  selection,
}: AriGridProps) {
  const columnCount = data.dates.length;
  const [focus, setFocus] = React.useState({ row: 0, col: 0 });
  const cellRefs = React.useRef(new Map<string, HTMLElement>());
  const shouldFocus = React.useRef(false);
  const today = useToday();

  /**
   * The legend overlays the bottom of the scroll area, so the rows need to be
   * able to clear it. Measured rather than assumed: it wraps to a second line
   * on narrower screens, and a guessed padding either strands the last row
   * under the legend or leaves dead space below it.
   */
  const legendRef = React.useRef<HTMLDivElement | null>(null);
  const [legendHeight, setLegendHeight] = React.useState(0);

  React.useEffect(() => {
    const legend = legendRef.current;
    if (!legend) return;

    const observer = new ResizeObserver(([entry]) => {
      setLegendHeight(entry.contentRect.height);
    });
    observer.observe(legend);
    return () => observer.disconnect();
  }, []);

  const registerCell = React.useCallback(
    (rowIndex: number, colIndex: number, node: HTMLElement | null) => {
      const key = `${rowIndex}:${colIndex}`;
      if (node) cellRefs.current.set(key, node);
      else cellRefs.current.delete(key);
    },
    [],
  );

  const gridTemplate = `${RAIL_WIDTH}px repeat(${columnCount}, minmax(${COLUMN_MIN}px, 1fr))`;
  const minWidth = RAIL_WIDTH + columnCount * (COLUMN_MIN + GAP);

  const common = {
    focus,
    onFocusCell: setFocus,
    registerCell,
    gridTemplate,
    dates: data.dates,
    today,
  };

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
        <RoomTypeRowView
          {...common}
          room={room}
          rowIndex={rowIndex}
          expanded={expandedRooms.has(room.id)}
          onToggle={() => onToggleRoom(room.id)}
          onSelect={onSelect}
          selection={selection}
          draftEditFor={draftEditFor}
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
              {...common}
              room={room}
              plan={plan}
              rowIndex={rowIndex}
              onSelect={onSelect}
              selection={selection}
              currency={data.currency}
              stayLength={data.stayLength}
              draftEditFor={draftEditFor}
              onRangeSelect={onRangeSelect}
              rangeSelection={rangeSelection}
            />
          ),
        });
      }

      if (room.ratePlans.length === 0) {
        rows.push({
          key: `${room.id}:empty`,
          index: rowCount,
          render: () => <NoRatePlansRow gridTemplate={gridTemplate} />,
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-auto"
        role="grid"
        aria-label="Availability, rates and restrictions by date"
        aria-rowcount={rowCount + 1}
        aria-colcount={columnCount + 1}
        onKeyDown={handleKeyDown}
      >
        <div
          style={{ minWidth, paddingBottom: legendHeight + 4 }}
          className="space-y-2.5"
        >
          <HeaderRow
            dates={data.dates}
            gridTemplate={gridTemplate}
            today={today}
          />

          {groups.map((group) => (
            <div
              key={group.room.id}
              role="rowgroup"
              className="rounded-[14px] bg-(--ari-group) p-1.5"
            >
              {group.rows.map((row) => (
                <React.Fragment key={row.key}>
                  {row.render(row.index)}
                </React.Fragment>
              ))}
            </div>
          ))}

          {data.rooms.length === 0 && (
            <p className="p-8 text-center text-muted-foreground text-sm">
              No room types match the current filters.
            </p>
          )}
        </div>
      </div>

      <GridLegend ref={legendRef} />
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
const dayFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric" });

function parseDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`);
}

// ─────────────────────────────────────────────
// Header
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
    <div
      role="row"
      className="sticky top-0 z-30 grid bg-background pb-1"
      style={{ gridTemplateColumns: gridTemplate, gap: GAP }}
    >
      <div
        className="sticky left-0 z-10 flex items-end bg-background pb-2 text-[11px] text-muted-foreground uppercase tracking-wide"
        style={{ width: RAIL_WIDTH }}
      >
        Room type / rate plan
      </div>

      {dates.map((date) => {
        const isToday = date === today;
        return (
          <div
            key={date}
            role="columnheader"
            className={cn(
              "flex h-[52px] flex-col items-center justify-center rounded-[10px]",
              isToday && "bg-(--accent-3)",
              !isToday && isWeekend(date) && "bg-(--gray-a1)",
            )}
          >
            <span
              className={cn(
                "text-[10px] uppercase tracking-wide",
                isToday ? "text-(--accent-11)" : "text-muted-foreground",
              )}
            >
              {isToday ? "Today" : weekdayFormatter.format(parseDate(date))}
            </span>
            <span
              className={cn(
                "font-semibold text-base leading-tight tabular-nums",
                isToday ? "text-(--accent-11)" : "text-foreground",
              )}
            >
              {dayFormatter.format(parseDate(date))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Room type row — availability
// ─────────────────────────────────────────────

function RoomTypeRowView({
  room,
  expanded,
  onToggle,
  onSelect,
  selection,
  rowIndex,
  focus,
  onFocusCell,
  registerCell,
  gridTemplate,
  dates,
  today,
  draftEditFor,
}: RowCommonProps & {
  room: RoomTypeRow;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (selection: AriSelection) => void;
  selection: AriSelection | null;
  draftEditFor: DraftEditLookup;
}) {
  const byDate = new Map(room.availability.map((a) => [a.date, a]));
  const runs = buildClosureRuns(dates, byDate);

  return (
    <div
      role="row"
      className="grid"
      style={{ gridTemplateColumns: gridTemplate, gap: GAP }}
    >
      <div
        className="sticky left-0 z-10 rounded-[10px] bg-(--ari-group)"
        style={{ width: RAIL_WIDTH }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex h-[52px] w-full items-center gap-2 rounded-[10px] px-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
        >
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-sm leading-tight">
              {room.name}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground leading-tight">
              {room.totalUnits} room{room.totalUnits === 1 ? "" : "s"} ·{" "}
              {expanded ? "shared inventory" : openPlanSummary(room)}
            </span>
          </span>
        </button>
      </div>

      {runs.map((run) =>
        run.closure ? (
          <RoomClosureBar
            key={run.startIndex}
            room={room}
            run={run}
            rowIndex={rowIndex}
            focus={focus}
            onFocusCell={onFocusCell}
            registerCell={registerCell}
            onSelect={onSelect}
            cell={byDate.get(run.dates[0])!}
          />
        ) : (
          <AvailabilityCellView
            key={run.startIndex}
            room={room}
            cell={byDate.get(run.dates[0])!}
            colIndex={run.startIndex}
            rowIndex={rowIndex}
            focus={focus}
            onFocusCell={onFocusCell}
            registerCell={registerCell}
            onSelect={onSelect}
            isToday={run.dates[0] === today}
            active={
              selection?.kind === "availability" &&
              selection.room.id === room.id &&
              selection.cell.date === run.dates[0]
            }
            staged={Boolean(draftEditFor("roomClosure", room.id, run.dates[0]))}
          />
        ),
      )}
    </div>
  );
}

/**
 * Split a room type's dates into closure bars and single availability cells.
 *
 * Only closures merge. The counts must not: each is a different number, and a
 * bar spanning them would report a week's worth of rooms as one figure.
 */
function buildClosureRuns(
  dates: string[],
  byDate: Map<string, AvailabilityCell>,
): { startIndex: number; dates: string[]; closure: boolean }[] {
  const runs: { startIndex: number; dates: string[]; closure: boolean }[] = [];

  for (let i = 0; i < dates.length; i++) {
    const closure = byDate.get(dates[i])?.closure ?? null;

    if (!closure) {
      runs.push({ startIndex: i, dates: [dates[i]], closure: false });
      continue;
    }

    let end = i + 1;
    while (
      end < dates.length &&
      byDate.get(dates[end])?.closure?.id === closure.id
    ) {
      end++;
    }
    runs.push({ startIndex: i, dates: dates.slice(i, end), closure: true });
    i = end - 1;
  }

  return runs;
}

function AvailabilityCellView({
  room,
  cell,
  colIndex,
  rowIndex,
  focus,
  onFocusCell,
  registerCell,
  onSelect,
  isToday,
  active,
  staged,
}: {
  room: RoomTypeRow;
  cell: AvailabilityCell;
  colIndex: number;
  rowIndex: number;
  focus: { row: number; col: number };
  onFocusCell: (next: { row: number; col: number }) => void;
  registerCell: (row: number, col: number, node: HTMLElement | null) => void;
  onSelect: (selection: AriSelection) => void;
  isToday: boolean;
  active: boolean;
  staged: boolean;
}) {
  const level = availabilityLevel(cell.effective, cell.totalUnits);
  const soldOut = level === "sold_out";
  // Zero-capacity dates would divide by zero, and are sold out anyway.
  const fraction =
    cell.totalUnits > 0 ? Math.min(1, cell.effective / cell.totalUnits) : 0;

  return (
    <button
      type="button"
      role="gridcell"
      ref={(node) => registerCell(rowIndex, colIndex, node)}
      tabIndex={focus.row === rowIndex && focus.col === colIndex ? 0 : -1}
      onFocus={() => onFocusCell({ row: rowIndex, col: colIndex })}
      onClick={() => onSelect({ kind: "availability", room, cell })}
      aria-label={`${room.name}, ${formatFullDate(cell.date)}: ${
        soldOut
          ? "sold out"
          : `${cell.effective} of ${cell.totalUnits} available${
              level === "low" ? ", running low" : ""
            }`
      }${cell.source === "override" ? ", set by hand" : ""}${
        staged ? ", unpublished change" : ""
      }`}
      className={cn(
        "flex h-[52px] flex-col justify-center gap-1.5 rounded-[10px] border border-(--ari-border) bg-(--ari-cell) px-2.5 text-left transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
        isToday && "border-(--accent-7) bg-(--accent-3)",
        active && "ring-2 ring-(--accent-11)",
        staged && "border-dashed border-primary",
      )}
    >
      {soldOut ? (
        <span className="font-medium text-(--ari-soldout-fg) text-sm leading-tight">
          Sold out
        </span>
      ) : (
        <>
          <span className="text-sm leading-none tabular-nums">
            <span className="font-semibold">{cell.effective}</span>
            <span className="text-muted-foreground"> / {cell.totalUnits}</span>
            {cell.source === "override" && (
              <span
                className="ml-1 text-[10px] text-muted-foreground"
                title="Set by hand"
                aria-hidden
              >
                ●
              </span>
            )}
          </span>
          {/* The number says how many; the bar says how full — which is what a
              host reads across a fortnight without stopping on each column. */}
          <span
            className="h-1 w-full overflow-hidden rounded-full bg-(--gray-a5)"
            aria-hidden
          >
            <span
              className={cn(
                "block h-full rounded-full",
                level === "low"
                  ? "bg-(--ari-avail-low)"
                  : "bg-(--ari-avail-ok)",
              )}
              style={{ width: `${Math.max(6, fraction * 100)}%` }}
            />
          </span>
        </>
      )}
    </button>
  );
}

/** The hatched bar across a closed room type's dates. */
function RoomClosureBar({
  room,
  run,
  rowIndex,
  focus,
  onFocusCell,
  registerCell,
  onSelect,
  cell,
}: {
  room: RoomTypeRow;
  run: { startIndex: number; dates: string[] };
  rowIndex: number;
  focus: { row: number; col: number };
  onFocusCell: (next: { row: number; col: number }) => void;
  registerCell: (row: number, col: number, node: HTMLElement | null) => void;
  onSelect: (selection: AriSelection) => void;
  cell: AvailabilityCell;
}) {
  const span = run.dates.length;
  const closure = cell.closure!;
  const focused =
    focus.row === rowIndex &&
    focus.col >= run.startIndex &&
    focus.col < run.startIndex + span;
  const Icon = CELL_STATE_STYLE.room_closed.icon;

  return (
    <button
      type="button"
      role="gridcell"
      ref={(node) => {
        for (let col = run.startIndex; col < run.startIndex + span; col++) {
          registerCell(rowIndex, col, node);
        }
      }}
      tabIndex={focused ? 0 : -1}
      onFocus={() =>
        onFocusCell({ row: rowIndex, col: focused ? focus.col : run.startIndex })
      }
      onClick={() => onSelect({ kind: "availability", room, cell })}
      style={{ gridColumn: `span ${span}`, ...HATCH_STYLE }}
      aria-label={`${room.name}, ${formatDateRange(
        run.dates[0],
        run.dates[span - 1],
      )}: room type closed${closure.note ? `, note: ${closure.note}` : ""}`}
      className="flex h-[52px] items-center gap-2 overflow-hidden rounded-[10px] border border-(--ari-border-strong) px-3 text-left text-(--ari-soldout-fg) text-xs transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        Room type closed{closure.note ? ` · ${closure.note}` : ""}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────
// Rate plan row
// ─────────────────────────────────────────────

function RatePlanRowView({
  room,
  plan,
  onSelect,
  selection,
  rowIndex,
  focus,
  onFocusCell,
  registerCell,
  gridTemplate,
  today,
  currency,
  stayLength,
  draftEditFor,
  onRangeSelect,
  rangeSelection,
}: RowCommonProps & {
  room: RoomTypeRow;
  plan: RatePlanRow;
  currency: string;
  stayLength: number;
  onSelect: (selection: AriSelection) => void;
  selection: AriSelection | null;
  draftEditFor: DraftEditLookup;
  onRangeSelect: AriGridProps["onRangeSelect"];
  rangeSelection: RangeSelection | null;
}) {
  const runs = buildRuns(plan.cells);
  // Only this row's own selection highlights. A range belongs to one rate
  // plan, so another row's selection must not tint cells here.
  const range = rangeSelection?.plan.id === plan.id ? rangeSelection : null;
  const caption = planCaption(plan);

  return (
    <div
      role="row"
      className="mt-1 grid"
      style={{ gridTemplateColumns: gridTemplate, gap: GAP }}
    >
      <div
        className="sticky left-0 z-10 flex h-14 items-center rounded-[10px] bg-(--ari-group) pr-2 pl-[38px]"
        style={{ width: RAIL_WIDTH }}
      >
        <StatusDot status={plan.status} />
        <span className="ml-2 min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium text-sm leading-tight">
              {plan.name}
            </span>
            <PolicyTag refundable={plan.isRefundable} />
          </span>
          {caption && (
            <span className="block truncate text-[11px] text-muted-foreground leading-tight">
              {caption}
            </span>
          )}
        </span>
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
          draftEditFor={draftEditFor}
          onRangeSelect={onRangeSelect}
          range={range}
          isToday={run.cells[0].date === today}
          active={
            selection?.kind === "rate" &&
            selection.plan.id === plan.id &&
            selection.run.startIndex === run.startIndex
          }
        />
      ))}
    </div>
  );
}

/**
 * The muted line under a rate plan's name.
 *
 * Its cancellation terms where they are short enough to read at a glance, and
 * its stay rules otherwise. Both bear on which plan to reprice, and neither is
 * visible from the numbers.
 */
function planCaption(plan: RatePlanRow): string {
  const parts: string[] = [];
  if (plan.cancellationPolicy && plan.cancellationPolicy.length <= 40) {
    parts.push(plan.cancellationPolicy);
  }
  if (plan.minStay > 1) parts.push(`min ${plan.minStay} nights`);
  if (plan.maxStay !== null) parts.push(`max ${plan.maxStay} nights`);
  if (parts.length === 0 && plan.hasStayDiscount) {
    parts.push("length-of-stay discount");
  }
  return parts.join(" · ");
}

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
  draftEditFor,
  onRangeSelect,
  range,
  isToday,
  active,
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
  draftEditFor: DraftEditLookup;
  onRangeSelect: AriGridProps["onRangeSelect"];
  range: RangeSelection | null;
  isToday: boolean;
  active: boolean;
}) {
  const span = run.endIndex - run.startIndex;
  const focused = focus.row === rowIndex && withinRun(focus.col, run);
  const selected =
    range !== null &&
    run.startIndex <= range.endIndex &&
    run.endIndex > range.startIndex;

  // A run is staged when any date it covers is. A bar with one edited night
  // inside it is not clean, and drawing it clean is how a host publishes
  // something they did not know they had queued.
  const staged = run.cells.some(
    (cell) =>
      draftEditFor("price", plan.id, cell.date) ??
      draftEditFor("closure", plan.id, cell.date) ??
      draftEditFor("restriction", plan.id, cell.date) ??
      draftEditFor("roomClosure", room.id, cell.date),
  );

  // A bar covers several columns but is one element. Registering it under
  // every column it spans is what lets arrow-key focus land on it from any of
  // them instead of falling into a gap.
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
    // Shift picks out a range to act on; a plain click opens the panel. Both
    // start from this column, so the host can shift-click straight after a
    // normal one without re-aiming.
    onClick: (event: React.MouseEvent) => {
      onRangeSelect(room, plan, run.startIndex, event.shiftKey);
      if (!event.shiftKey) onSelect({ kind: "rate", room, plan, run });
    },
    "aria-selected": selected || undefined,
    style: { gridColumn: `span ${span}` },
  };

  const first = run.cells[0];

  // Testing the state as well as the flag is what tells the compiler a bar can
  // only ever be a non-open state, which is what CELL_STATE_STYLE is keyed on.
  if (run.state === "open" || first.bookable) {
    const restriction = chipLabel(first.reasons);
    const adjustment = adjustmentChip(first);

    return (
      <HoverCard openDelay={200} closeDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            {...commonProps}
            aria-label={`${rateCellLabel(plan, first, currency)}${
              staged ? ", unpublished change" : ""
            }`}
            className={cn(
              "flex h-14 flex-col justify-center gap-1 rounded-[10px] border border-(--ari-border) bg-(--ari-cell) px-2.5 text-left transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
              isToday && "border-(--accent-7)",
              active && "ring-2 ring-(--accent-11)",
              selected && "bg-primary/15 ring-2 ring-(--accent-11) ring-inset",
              staged && "border-dashed border-primary",
            )}
          >
            <span className="flex items-baseline gap-1">
              <span className="font-semibold text-sm tabular-nums">
                {first.price === null ? "—" : formatMoney(first.price, currency)}
              </span>
              {/* When a restriction has taken the chip slot, the fact that the
                  price also moved survives as a dot. Dropping it entirely
                  would make an adjusted cell look like a plain one. */}
              {adjustment && restriction && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-(--ari-adjusted-fg)"
                  title={`Price adjusted ${adjustment}`}
                  aria-hidden
                />
              )}
              {first.stayDiscountPending && (
                <span className="text-muted-foreground" aria-hidden>
                  *
                </span>
              )}
            </span>

            {/* One chip slot, ranked: unpublished, then the restriction a
                guest would hit, then how the price got here. */}
            {staged ? (
              <Chip tone="unsaved">Unsaved</Chip>
            ) : restriction ? (
              <Chip tone="restricted">{restriction}</Chip>
            ) : adjustment ? (
              <Chip tone="adjusted">{adjustment}</Chip>
            ) : null}
          </button>
        </HoverCardTrigger>
        <HoverCardContent align="center" className="w-72">
          <RateHoverSummary
            plan={plan}
            cell={first}
            currency={currency}
            stayLength={stayLength}
          />
        </HoverCardContent>
      </HoverCard>
    );
  }

  const style = CELL_STATE_STYLE[run.state];
  const Icon = style.icon;
  const note =
    first.reasons[0]?.source.kind === "host"
      ? first.reasons[0].source.note
      : null;

  // Sold out keeps its price, struck through: it is the rate the date actually
  // sold at, and a host looking at a full week is often deciding whether it
  // was priced too cheaply.
  if (run.state === "sold_out") {
    return (
      <button
        type="button"
        {...commonProps}
        aria-label={`${barLabel(plan, run, note)}${
          staged ? ", unpublished change" : ""
        }`}
        className={cn(
          "flex h-14 flex-col justify-center gap-1 rounded-[10px] border px-2.5 text-left transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
          style.className,
          active && "ring-2 ring-(--accent-11)",
          staged && "border-dashed border-primary",
        )}
      >
        <span className="font-semibold text-muted-foreground text-sm line-through tabular-nums">
          {formatMoney(first.indicativePrice, currency)}
        </span>
        <Chip tone={staged ? "unsaved" : "sold_out"}>
          {staged ? "Unsaved" : "Sold out"}
        </Chip>
      </button>
    );
  }

  return (
    <button
      type="button"
      {...commonProps}
      style={{
        ...commonProps.style,
        ...(style.hatch ? HATCH_STYLE : undefined),
      }}
      aria-label={`${barLabel(plan, run, note)}${
        staged ? ", unpublished change" : ""
      }`}
      className={cn(
        "flex h-14 items-center gap-2 overflow-hidden rounded-[10px] border px-3 text-left text-xs transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
        style.className,
        active && "ring-2 ring-(--accent-11)",
        staged && "border-dashed border-primary",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {run.state === "room_closed"
          ? "Inherited: room type closed"
          : `${style.label}${note ? ` · ${note}` : ""}`}
        {staged && " · Unsaved"}
      </span>
      {span > 1 && (
        <span className="ml-auto shrink-0 text-[10px] line-through opacity-70 tabular-nums">
          {formatMoney(first.indicativePrice, currency)}
        </span>
      )}
    </button>
  );
}

function withinRun(col: number, run: CellRun) {
  return col >= run.startIndex && col < run.endIndex;
}

/** A room type with nothing to sell yet, rather than a silently empty card. */
function NoRatePlansRow({ gridTemplate }: { gridTemplate: string }) {
  return (
    <div
      role="row"
      className="mt-1 grid"
      style={{ gridTemplateColumns: gridTemplate, gap: GAP }}
    >
      <div
        className="sticky left-0 z-10 flex h-14 items-center rounded-[10px] bg-(--ari-group) pr-2 pl-[38px] text-muted-foreground text-sm"
        style={{ width: RAIL_WIDTH }}
      >
        Add a rate plan to start selling
      </div>
    </div>
  );
}

/**
 * What a screen reader hears on a sellable cell: the plan, the date, the
 * price, and any restriction riding with it. The restriction is spoken in
 * full — the chip abbreviates it to fit the column, which is not a constraint
 * a listener shares.
 */
function rateCellLabel(
  plan: RatePlanRow,
  cell: RateCell,
  currency: string,
): string {
  const price =
    cell.price === null ? "no rate" : formatMoney(cell.price, currency);
  const restrictions =
    cell.reasons.length > 0 ? `, ${reasonsPhrase(cell.reasons)}` : "";
  return `${plan.name}, ${formatFullDate(cell.date)}: ${price}${restrictions}`;
}

/**
 * A bar speaks its whole range, its reason and the host's note.
 *
 * The visual bar already spans its dates; a screen reader has only this
 * string, so "closed" alone would leave a listener unable to tell a one-night
 * closure from a fortnight.
 */
function barLabel(plan: RatePlanRow, run: CellRun, note: string | null): string {
  const first = run.cells[0];
  const last = run.cells[run.cells.length - 1];
  const when =
    first.date === last.date
      ? formatFullDate(first.date)
      : formatDateRange(first.date, last.date);
  return `${plan.name}, ${when}: ${reasonsPhrase(first.reasons)}${
    note ? `, note: ${note}` : ""
  }`;
}

/**
 * Condensed build-up on hover. Auditing a week of pricing by opening the panel
 * on every cell is too slow — hover answers "why this number?" while scanning,
 * the panel answers it for a decision.
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
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{plan.name}</span>
        <span className="text-muted-foreground text-xs">
          {formatFullDate(cell.date)}
        </span>
      </div>

      <ul className="space-y-1">
        {cell.trace.map((step, index) => (
          <li
            key={`${step.label}:${index}`}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="flex items-baseline gap-1.5 text-muted-foreground text-xs">
              {step.label}
              {step.modifier_type && (
                <span className="tabular-nums">
                  {formatAdjustment(
                    step.op === "percent" ? "percent" : "flat",
                    step.value,
                    currency,
                  )}
                </span>
              )}
            </span>
            <span className="text-xs tabular-nums">
              {formatMoney(step.result, currency)}
            </span>
          </li>
        ))}
      </ul>

      {cell.reasons.length > 0 && (
        <p className="border-t pt-2 text-muted-foreground text-xs">
          {reasonsPhrase(cell.reasons)}
        </p>
      )}

      {cell.stayDiscountPending && (
        <p className="text-muted-foreground text-xs">
          A longer stay would unlock a discount this{" "}
          {stayLength === 1 ? "one" : stayLength}-night probe does not show.
        </p>
      )}

      <p className="text-muted-foreground text-xs">
        {plan.modifiers.length === 0
          ? "No modifiers on this rate plan."
          : `Plan modifiers: ${plan.modifiers
              .map((m) => modifierLabel(m.type))
              .join(", ")}.`}
      </p>
    </div>
  );
}
