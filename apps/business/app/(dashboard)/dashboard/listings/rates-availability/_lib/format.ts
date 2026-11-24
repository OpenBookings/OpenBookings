import type { ModifierType } from "@openbookings/pricing";
import { formatCents } from "@openbookings/pricing/money";

const fullDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const rangeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Dates are date-only strings; parse as UTC so they don't shift a day. */
function parse(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function formatFullDate(isoDate: string): string {
  return fullDateFormatter.format(parse(isoDate));
}

export function formatDateRange(start: string, end: string): string {
  if (start === end) return formatFullDate(start);
  return `${rangeFormatter.format(parse(start))} – ${fullDateFormatter.format(parse(end))}`;
}

export function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : timestampFormatter.format(date);
}

export function isWeekend(isoDate: string): boolean {
  const day = parse(isoDate).getUTCDay();
  return day === 0 || day === 6;
}

const MODIFIER_LABELS: Record<ModifierType, string> = {
  day_of_week: "Day of week",
  length_of_stay: "Length of stay",
  early_bird: "Early bird",
  last_minute: "Last minute",
  extra_guest: "Extra guest",
};

export function modifierLabel(type: ModifierType): string {
  return MODIFIER_LABELS[type] ?? type;
}

/** "−10%" / "+€15" / "+€15.50" — signed so the direction reads without the tooltip. A flat value is cents. */
export function formatAdjustment(adjustmentType: "flat" | "percent", value: number): string {
  const sign = value < 0 ? "−" : "+";
  const magnitude = Math.abs(value);
  return adjustmentType === "percent" ? `${sign}${magnitude}%` : `${sign}${formatCents(magnitude)}`;
}
