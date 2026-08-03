"use client";

import * as React from "react";
import {
  CalendarCog,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  FilterX,
  Plus,
  PencilLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { STAY_LENGTHS, type RoomTypeRow } from "../_lib/types";
import { formatDateRange } from "../_lib/format";

export interface RangePreset {
  label: string;
  days: number;
}

export const RANGE_PRESETS: RangePreset[] = [
  { label: "Next 7 days", days: 7 },
  { label: "Next 14 days", days: 14 },
  { label: "Next 30 days", days: 30 },
];

interface AriToolbarProps {
  startDate: string;
  endDate: string;
  windowDays: number;
  stayLength: number;
  rooms: RoomTypeRow[];
  hiddenRoomIds: Set<string>;
  issuesOnly: boolean;
  pending: boolean;
  onShift: (days: number) => void;
  onToday: () => void;
  onWindowChange: (days: number) => void;
  onStayLengthChange: (nights: number) => void;
  onToggleRoomFilter: (roomId: string) => void;
  onIssuesOnlyChange: (value: boolean) => void;
  onClearFilters: () => void;
  onOpenDialog: (kind: "availability" | "restrictions" | "rate-plan") => void;
}

export function AriToolbar({
  startDate,
  endDate,
  windowDays,
  stayLength,
  rooms,
  hiddenRoomIds,
  issuesOnly,
  pending,
  onShift,
  onToday,
  onWindowChange,
  onStayLengthChange,
  onToggleRoomFilter,
  onIssuesOnlyChange,
  onClearFilters,
  onOpenDialog,
}: AriToolbarProps) {
  const activeFilterCount = hiddenRoomIds.size + (issuesOnly ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 lg:px-6">
      {/* Chevrons hug the word they move, so the whole control reads as one
          thing: "step the period I'm looking at". */}
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onShift(-windowDays)}
          aria-label="Previous period"
          disabled={pending}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          className="h-8 px-2 font-medium text-base"
          onClick={onToday}
          disabled={pending}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onShift(windowDays)}
          aria-label="Next period"
          disabled={pending}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <span
        className={cn(
          "px-1 text-sm tabular-nums transition-opacity",
          pending ? "opacity-50" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {formatDateRange(startDate, endDate)}
      </span>

      <Select
        value={String(windowDays)}
        onValueChange={(v) => onWindowChange(Number(v))}
      >
        <SelectTrigger className="w-40 rounded-full" aria-label="Date range">
          <CalendarDays className="size-4 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_PRESETS.map((preset) => (
            <SelectItem key={preset.days} value={String(preset.days)}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={String(stayLength)}
        onValueChange={(v) => onStayLengthChange(Number(v))}
      >
        <SelectTrigger
          className="w-44 rounded-full"
          aria-label="Show rates for stay length"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STAY_LENGTHS.map((nights) => (
            <SelectItem key={nights} value={String(nights)}>
              Rates for {nights} night{nights === 1 ? "" : "s"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="rounded-full">
            <Filter className="size-4" />
            Filter
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-primary-foreground text-xs tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Room types</DropdownMenuLabel>
          <div className="space-y-2 px-2 py-1.5">
            {rooms.map((room) => (
              <div key={room.id} className="flex items-center gap-2">
                <Checkbox
                  id={`filter-${room.id}`}
                  checked={!hiddenRoomIds.has(room.id)}
                  onCheckedChange={() => onToggleRoomFilter(room.id)}
                />
                <Label
                  htmlFor={`filter-${room.id}`}
                  className="truncate font-normal text-sm"
                >
                  {room.name}
                </Label>
              </div>
            ))}
          </div>
          <DropdownMenuSeparator />
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Checkbox
              id="filter-issues"
              checked={issuesOnly}
              onCheckedChange={(v) => onIssuesOnlyChange(v === true)}
            />
            <Label htmlFor="filter-issues" className="font-normal text-sm">
              Show only with issues
            </Label>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Filters now outlive the week you set them in, so the way out has to be
          on the toolbar itself — not buried behind the menu that hid the rooms. */}
      {activeFilterCount > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-full"
                onClick={onClearFilters}
                aria-label={`Clear ${activeFilterCount} filter${
                  activeFilterCount === 1 ? "" : "s"
                }`}
              >
                <FilterX className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear filters</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => onOpenDialog("availability")}
        >
          <CalendarCog className="size-4" />
          Edit availability
        </Button>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => onOpenDialog("restrictions")}
        >
          <PencilLine className="size-4" />
          Edit restrictions
        </Button>
        <Button
          className="rounded-full"
          onClick={() => onOpenDialog("rate-plan")}
        >
          <Plus className="size-4" />
          Add rate plan
        </Button>
      </div>
    </div>
  );
}
