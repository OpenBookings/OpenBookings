import { PAGES } from "./pages";
import type { AnyPageData, Bar, Point, Share, StatValue, Widget } from "./types";

type Cell = string | number | null;
type Row = Cell[];

function escape(field: Cell): string {
  if (field === null) return "";
  const text = String(field);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const toCsv = (rows: Row[]): string => rows.map((row) => row.map(escape).join(",")).join("\n");

/** Cents are an internal unit. A host opening this in a spreadsheet wants euros. */
const euros = (cents: number | null): string | null => (cents === null ? null : (cents / 100).toFixed(2));
const decimal = (value: number | null): string | null => (value === null ? null : value.toFixed(1));
const whole = (value: number | null): string | null => (value === null ? null : String(value));

/**
 * A widget that declined leaves a visible note. A blank block would read as
 * "nothing happened", which is a different and wrong claim. This is also what
 * keeps the file under the same suppression as the screen: it can only print
 * what the view model holds.
 */
function rowsFor<T>(label: string, w: Widget<T>, build: (value: T) => Row[]): Row[] {
  if (w.ok) return build(w.value);
  return [[label, "", w.reason === "below-minimum" ? "not enough data" : "unavailable", ""]];
}

const stat = (label: string, w: Widget<StatValue>, format: (v: number | null) => string | null): Row[] =>
  rowsFor(label, w, (v) => [[label, "", format(v.value), v.delta?.label ?? ""]]);

const points = (label: string, w: Widget<Point[]>, format: (v: number | null) => string | null): Row[] =>
  rowsFor(label, w, (rows) => rows.map((p) => [label, p.bucket, format(p.value), p.incomplete ? "incomplete" : ""]));

const shares = (label: string, w: Widget<Share[]>, format: (v: number | null) => string | null): Row[] =>
  rowsFor(label, w, (rows) => rows.map((r) => [label, r.label, format(r.value), `${r.sharePct.toFixed(1)}%`]));

const bars = (label: string, w: Widget<Bar[]>, format: (v: number | null) => string | null): Row[] =>
  rowsFor(label, w, (rows) => rows.map((r) => [label, r.label, format(r.value), ""]));

function body(data: AnyPageData): Row[] {
  switch (data.page) {
    case "revenue": {
      const v = data.view;
      return [
        ...stat("Revenue (EUR)", v.revenue, euros),
        ...stat("Year to date (EUR)", v.yearToDate, euros),
        ...stat("ADR (EUR)", v.adr, euros),
        ...stat("RevPAR (EUR)", v.revpar, euros),
        ...stat("Commission 4.5% (EUR)", v.commission, euros),
        ...points("Revenue over time (EUR)", v.overTime, euros),
        ...shares("Revenue by room type (EUR)", v.byRoomType, euros),
        ...shares("Revenue by rate plan (EUR)", v.byRatePlan, euros),
      ];
    }
    case "occupancy": {
      const v = data.view;
      return [
        ...stat("Occupancy (%)", v.occupancy, decimal),
        ...stat("Nights sold", v.nightsSold, whole),
        ...stat("Nights available", v.nightsAvailable, whole),
        ...stat("Unsold nights, next 30 days", v.unsoldNext30, whole),
        ...points("Occupancy over time (%)", v.overTime, decimal),
        ...rowsFor("Next 90 days", v.next90, (cells) =>
          cells.map((c) => ["Next 90 days", c.date, c.sold, `of ${c.available} available`]),
        ),
        ...(v.pace ? points("Pace, nights on the books", v.pace, whole) : []),
        ...bars("Occupancy by weekday (%)", v.byWeekday, decimal),
      ];
    }
    case "booking-patterns": {
      const v = data.view;
      return [
        ...stat("Bookings", v.bookings, whole),
        ...stat("Median lead time (days)", v.medianLeadDays, decimal),
        ...stat("Median stay length (nights)", v.medianStayNights, decimal),
        ...stat("Cancellation rate (%)", v.cancellationRate, decimal),
        ...bars("Lead time (bookings)", v.leadTime, whole),
        ...bars("Stay length (bookings)", v.stayLength, whole),
        ...bars("Cancellations by days before check-in", v.cancellationsByDaysBefore, whole),
        ...rowsFor("Cancellations by rate plan", v.byRatePlan, (rows) =>
          rows.flatMap((r): Row[] => [
            ["Cancellation rate by rate plan (%)", r.label, decimal(r.ratePct), `${r.cancelled} of ${r.bookings}`],
            ["Cancellation fees retained (EUR)", r.label, euros(r.feesRetainedCents), ""],
          ]),
        ),
      ];
    }
    case "pricing": {
      const v = data.view;
      return [
        ...stat("ADR (EUR)", v.adr, euros),
        ...rowsFor("Discounts given (EUR)", v.discounts, (d) => [
          ["Discounts given (EUR)", "", euros(d.value), d.delta?.label ?? ""],
          ["Bookings with a discount (%)", "", decimal(d.shareOfBookingsPct), ""],
        ]),
        ...stat("Average discount depth (%)", v.discountDepth, decimal),
        ...points("ADR over time (EUR)", v.adrOverTime, euros),
        ...rowsFor("By rate plan", v.byRatePlan, (rows) =>
          rows.flatMap((r): Row[] => [
            ["Bookings by rate plan", r.label, r.bookings, ""],
            ["Nights by rate plan", r.label, r.nights, ""],
            ["ADR by rate plan (EUR)", r.label, euros(r.adrCents), ""],
            ["Revenue by rate plan (EUR)", r.label, euros(r.revenueCents), ""],
          ]),
        ),
        ...rowsFor("By weekday", v.byWeekday, (rows) =>
          rows.flatMap((r): Row[] => [
            ["Occupancy by weekday (%)", r.label, decimal(r.occupancyPct), ""],
            ["ADR by weekday (EUR)", r.label, euros(r.adrCents), r.hint ? "sells out below average rate" : ""],
          ]),
        ),
      ];
    }
    case "guests": {
      const v = data.view;
      return [
        ...stat("Returning guests (%)", v.returning, decimal),
        ...stat("Median party size", v.medianPartySize, decimal),
        ...shares("Booker country", v.countries, whole),
        ...shares("Group type", v.groupTypes, whole),
      ];
    }
  }
}

export function pageCsv(data: AnyPageData): string {
  const header: Row[] = [
    ["Page", PAGES[data.page].title],
    ["From", data.range.from],
    ["To", data.range.to],
  ];
  return `${toCsv(header)}\n\n${toCsv([["Metric", "Key", "Value", "Note"], ...body(data)])}\n`;
}

export function csvFilename(data: AnyPageData): string {
  return `analytics-${data.page}-${data.range.from}-to-${data.range.to}.csv`;
}
