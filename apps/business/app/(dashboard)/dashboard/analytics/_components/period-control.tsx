"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon } from "lucide-react";
import type { DateRange as PickerRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRange } from "@/lib/analytics/format";
import {
  COMPARE_LABELS,
  COMPARE_MODES,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type CompareMode,
  type DateRange,
  type PeriodPreset,
} from "@/lib/analytics/period";
import type { IsoDate } from "@/lib/analytics/types";

interface PeriodControlProps {
  preset: PeriodPreset;
  range: DateRange;
  compare: CompareMode;
  canCompareLastYear: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");
const toIso = (date: Date): IsoDate =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** The calendar hands back local Dates; midday keeps a timezone shift off the previous day. */
const fromIso = (value: IsoDate): Date => new Date(`${value}T12:00:00`);

function Option({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={selected ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className="w-full justify-start"
    >
      {children}
    </Button>
  );
}

/**
 * Period and comparison in one control that carries its own label. Both live
 * in the URL, so a view is shareable, survives a refresh, and follows the host
 * to the next analytics page.
 */
export function PeriodControl({ preset, range, compare, canCompareLastYear }: PeriodControlProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  // Merged into the existing params, so `demo` survives a filter change.
  const setParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
  };

  const selectPreset = (next: PeriodPreset) =>
    setParams(
      next === "custom"
        ? { period: next, from: range.from, to: range.to }
        : { period: next, from: null, to: null },
    );

  const selectRange = (selected: PickerRange | undefined) => {
    if (!selected?.from) return;
    setParams({ period: "custom", from: toIso(selected.from), to: toIso(selected.to ?? selected.from) });
  };

  const summary = [
    preset === "custom" ? formatRange(range) : PERIOD_LABELS[preset],
    compare === "none" ? null : `vs ${COMPARE_LABELS[compare].toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} aria-label={`Period: ${summary}`}>
          <CalendarIcon aria-hidden />
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] p-3">
        <div className="flex flex-wrap gap-6">
          <fieldset>
            <legend className="mb-1.5 text-muted-foreground text-xs">Period</legend>
            <div className="flex flex-col gap-0.5">
              {PERIOD_PRESETS.map((value) => (
                <Option key={value} selected={value === preset} onClick={() => selectPreset(value)}>
                  {PERIOD_LABELS[value]}
                </Option>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-muted-foreground text-xs">Compare with</legend>
            <div className="flex flex-col gap-0.5">
              {COMPARE_MODES.map((value) => {
                const unavailable = value === "last-year" && !canCompareLastYear;
                const option = (
                  <Option
                    key={value}
                    selected={value === compare}
                    disabled={unavailable}
                    onClick={() => setParams({ compare: value })}
                  >
                    {COMPARE_LABELS[value]}
                  </Option>
                );
                // A disabled button fires no pointer events, so the tooltip hangs off a wrapper.
                return unavailable ? (
                  <Tooltip key={value}>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>{option}</span>
                    </TooltipTrigger>
                    <TooltipContent>Available once you have 12 months of data</TooltipContent>
                  </Tooltip>
                ) : (
                  option
                );
              })}
            </div>
          </fieldset>
        </div>
        {preset === "custom" ? (
          <div className="mt-3 border-t pt-3">
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={fromIso(range.from)}
              selected={{ from: fromIso(range.from), to: fromIso(range.to) }}
              onSelect={selectRange}
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
