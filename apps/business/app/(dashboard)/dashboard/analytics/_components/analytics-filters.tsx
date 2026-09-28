"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type PeriodPreset,
} from "@/lib/analytics/period";
import type { IsoDate, PropertySummary } from "@/lib/analytics/types";

interface AnalyticsFiltersProps {
  preset: PeriodPreset;
  range: { from: IsoDate; to: IsoDate };
  properties: PropertySummary[];
  selectedPropertyId: string;
}

const toIso = (date: Date): IsoDate =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** The Calendar hands back local Dates; parse back through midday to avoid a
 * timezone shift pushing the selection onto the previous day. */
const fromIso = (value: IsoDate): Date => new Date(`${value}T12:00:00`);

export function AnalyticsFilters({
  preset,
  range,
  properties,
  selectedPropertyId,
}: AnalyticsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  /**
   * Filters live in the URL, so the view is shareable and survives a refresh.
   * Merging into the existing params rather than rebuilding them keeps `demo`
   * and `fail` alive across a filter change.
   */
  const setParams = React.useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
    },
    [router, searchParams],
  );

  const onPresetChange = (value: string) => {
    const next = value as PeriodPreset;
    setParams(
      next === "custom"
        ? { period: next, from: range.from, to: range.to }
        : { period: next, from: null, to: null },
    );
  };

  const onRangeSelect = (selected: DateRange | undefined) => {
    if (!selected?.from) return;
    setParams({
      period: "custom",
      from: toIso(selected.from),
      to: toIso(selected.to ?? selected.from),
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 px-4 lg:px-6">
      <div className="space-y-1.5">
        <Label htmlFor="analytics-period">Period</Label>
        <Select value={preset} onValueChange={onPresetChange} disabled={pending}>
          <SelectTrigger id="analytics-period" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_PRESETS.map((value) => (
              <SelectItem key={value} value={value}>
                {PERIOD_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {preset === "custom" ? (
        <div className="space-y-1.5">
          <Label htmlFor="analytics-range">Dates</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button id="analytics-range" variant="outline" disabled={pending}>
                <CalendarIcon aria-hidden />
                {range.from} → {range.to}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                numberOfMonths={2}
                defaultMonth={fromIso(range.from)}
                selected={{ from: fromIso(range.from), to: fromIso(range.to) }}
                onSelect={onRangeSelect}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      {/* Only when there is a choice to make. One property needs no selector. */}
      {properties.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="analytics-property">Property</Label>
          <Select
            value={selectedPropertyId}
            onValueChange={(value) => setParams({ property: value })}
            disabled={pending}
          >
            <SelectTrigger id="analytics-property" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {properties.map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
