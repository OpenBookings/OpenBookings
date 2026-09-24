"use client";

import * as React from "react";
import { Ban, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RangeSelection } from "../_lib/types";
import type { DraftEdit } from "../_lib/use-ari-draft";
import { formatDateRange } from "../_lib/format";

/**
 * Acts on a shift-selected run of dates on one rate plan.
 *
 * Floating rather than docked: it only exists while there is a selection, and
 * a permanent strip of buttons that are usually disabled reads as chrome. It
 * sits above the grid so the selection it describes stays visible — a bar that
 * covers the dates it is about makes the host scroll to check what they picked.
 *
 * Like every other edit on this screen, these stage. Nothing here writes.
 */
export function RangeActionBar({
  range,
  onClear,
  onStage,
}: {
  range: RangeSelection | null;
  onClear: () => void;
  onStage: (edits: DraftEdit[]) => void;
}) {
  const [price, setPrice] = React.useState("");

  // A fresh selection starts with an empty field: carrying the last range's
  // number over invites staging it onto dates nobody meant to touch.
  const selectionKey = range
    ? `${range.plan.id}:${range.startIndex}:${range.endIndex}`
    : null;
  const [lastKey, setLastKey] = React.useState(selectionKey);
  if (selectionKey !== lastKey) {
    setLastKey(selectionKey);
    setPrice("");
  }

  // Esc clears, matching the panel. Registered only while a selection exists,
  // so it cannot swallow Esc from anything else on the screen.
  React.useEffect(() => {
    if (!range) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClear();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [range, onClear]);

  if (!range) return null;

  const cells = range.plan.cells.slice(range.startIndex, range.endIndex + 1);
  const dates = cells.map((cell) => cell.date);
  if (dates.length === 0) return null;

  const stage = (build: (date: string) => DraftEdit) =>
    onStage(dates.map(build));

  const parsed = Number(price);
  const priceValid =
    price.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;

  // Reopening is offered only when something on the run is actually closed on
  // this plan. A room-type closure is lifted on the room type, not here.
  const anyPlanClosed = cells.some((cell) => cell.primary === "STOP_SELL");
  const anyBookable = cells.some((cell) => cell.bookable);

  return (
    <div
      role="region"
      aria-label="Edit selected dates"
      className="-translate-x-1/2 fixed bottom-6 left-1/2 z-40 flex flex-wrap items-center gap-2 rounded-full border bg-popover px-3 py-2 shadow-lg"
    >
      <span className="px-1 text-sm">
        <span className="font-medium">{range.plan.name}</span>
        <span className="text-muted-foreground">
          {" · "}
          {formatDateRange(dates[0], dates[dates.length - 1])}
          {" · "}
          {dates.length} night{dates.length === 1 ? "" : "s"}
        </span>
      </span>

      <div className="flex items-center gap-1">
        <Input
          inputMode="decimal"
          placeholder="Price"
          aria-label={`Set price for ${dates.length} selected nights`}
          className="h-8 w-24"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !priceValid) return;
            event.preventDefault();
            stage((date) => ({
              kind: "price",
              ratePlanId: range.plan.id,
              date,
              price: Math.round(parsed),
            }));
          }}
        />
        <Button
          size="sm"
          className="rounded-full"
          disabled={!priceValid}
          onClick={() =>
            stage((date) => ({
              kind: "price",
              ratePlanId: range.plan.id,
              date,
              price: Math.round(parsed),
            }))
          }
        >
          Set price
        </Button>
      </div>

      {anyBookable && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() =>
            stage((date) => ({
              kind: "closure",
              ratePlanId: range.plan.id,
              date,
              closed: true,
              note: null,
            }))
          }
        >
          <Ban className="size-4" />
          Close
        </Button>
      )}

      {anyPlanClosed && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() =>
            stage((date) => ({
              kind: "closure",
              ratePlanId: range.plan.id,
              date,
              closed: false,
              note: null,
            }))
          }
        >
          <Undo2 className="size-4" />
          Reopen
        </Button>
      )}

      <Button
        size="icon"
        variant="ghost"
        className="size-8 rounded-full"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
