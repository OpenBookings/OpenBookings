import type { AnalyticsData, Category, Point, Widget } from "./types";

export type SectionId = "revenue" | "sell-through" | "bookings" | "pricing" | "guests";

export const SECTION_TITLES: Record<SectionId, string> = {
  revenue: "Revenue",
  "sell-through": "Sell-through",
  bookings: "Bookings",
  pricing: "Pricing",
  guests: "Guests",
};

type Row = (string | number | null)[];

function escape(field: string | number | null): string {
  if (field === null) return "";
  const text = String(field);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const toCsv = (rows: Row[]): string => rows.map((row) => row.map(escape).join(",")).join("\n");

/** Cents are an internal unit. A host opening this in a spreadsheet wants euros. */
const euros = (cents: number | null): string | null =>
  cents === null ? null : (cents / 100).toFixed(2);

const pct = (value: number | null): string | null =>
  value === null ? null : value.toFixed(1);

/**
 * A failed widget leaves a visible note. A blank block would read as "nothing
 * happened here", which is a different and wrong claim.
 */
function rowsFor<T>(w: Widget<T>, build: (value: T) => Row[]): Row[] {
  return w.ok ? build(w.value) : [["This widget was unavailable when the file was exported."]];
}

const categories = (label: string, rows: Category[], format: (v: number) => string | null): Row[] =>
  rows.map((row) => [label, row.label, format(row.value), row.count ?? null]);

const series = (label: string, points: Point[], format: (v: number) => string | null): Row[] =>
  points.map((point) => [label, point.bucket, point.label, format(point.value)]);

export function sectionCsv(data: AnalyticsData, section: SectionId): string {
  const header: Row = [
    ["Property", data.property.name],
    ["Section", SECTION_TITLES[section]],
    ["From", data.range.from],
    ["To", data.range.to],
  ].flat() as Row;

  const rows: Row[] = [
    ["Metric", "Key", "Value", "Count"],
    ...bodyFor(data, section),
  ];

  return `${toCsv([header])}\n\n${toCsv(rows)}\n`;
}

function bodyFor(data: AnalyticsData, section: SectionId): Row[] {
  switch (section) {
    case "revenue":
      return [
        ...rowsFor(data.revenue.yearToDateCents, (v) => [["Year to date (EUR)", "", euros(v.value), v.delta.label]]),
        ...rowsFor(data.revenue.periodCents, (v) => [["Revenue in period (EUR)", "", euros(v.value), v.delta.label]]),
        ...rowsFor(data.revenue.adrCents, (v) => [["Average room price (EUR)", "", euros(v.value), null]]),
        ...rowsFor(data.revenue.revparCents, (v) => [["RevPAR (EUR)", "", euros(v.value), null]]),
        ...rowsFor(data.revenue.commissionCents, (v) => [["Commission paid (EUR)", "", euros(v), null]]),
        ...rowsFor(data.revenue.overTime, (v) => series("Revenue over time (EUR)", v, euros)),
        ...rowsFor(data.revenue.byRoomType, (v) => categories("Revenue by room type (EUR)", v, euros)),
        ...rowsFor(data.revenue.byRatePlan, (v) => categories("Revenue by rate plan (EUR)", v, euros)),
      ];
    case "sell-through":
      return [
        ...rowsFor(data.sellThrough.pct, (v) => [["Sell-through (%)", "", pct(v.value), v.delta.label]]),
        ...rowsFor(data.sellThrough.roomsSold, (v) => [["Rooms sold", "", v, null]]),
        ...rowsFor(data.sellThrough.overTime, (v) => series("Sell-through over time (%)", v, pct)),
        ...rowsFor(data.sellThrough.byRoomType, (v) => categories("Sell-through by room type (%)", v, pct)),
        ...rowsFor(data.sellThrough.busiestDays, (v) =>
          v.cells.map((cell) => [
            "Busiest days (%)",
            `${cell.weekStart} weekday ${cell.weekday}`,
            pct(cell.pct),
            cell.nightsSold,
          ]),
        ),
      ];
    case "bookings":
      return [
        ...rowsFor(data.bookings.count, (v) => [["Number of bookings", "", v.value, v.delta.label]]),
        ...rowsFor(data.bookings.averageLengthOfStay, (v) => [["Average length of stay (nights)", "", v === null ? null : v.toFixed(2), null]]),
        ...rowsFor(data.bookings.cancellations, (v) => [["Cancellations", "", v.count, v.delta.label]]),
        ...rowsFor(data.bookings.leadTime, (v) => categories("Lead time (bookings)", v, (n) => String(n))),
        ...rowsFor(data.bookings.upcoming, (v) =>
          v.flatMap((w) => [
            ["Upcoming nights sold", w.label, w.nightsSold, null],
            ["Upcoming nights available", w.label, w.nightsAvailable, null],
          ]),
        ),
      ];
    case "pricing":
      return [
        ...rowsFor(data.pricing.averageDiscountPct, (v) => [["Average discount (%)", "", pct(v), null]]),
        ...rowsFor(data.pricing.priceOverTime, (v) => [
          ...series("Base price (EUR)", v.base, euros),
          ...series("Achieved price (EUR)", v.achieved, euros),
        ]),
        ...rowsFor(data.pricing.topModifiers, (v) => categories("Modifier impact (EUR)", v, euros)),
      ];
    case "guests":
      return [
        ...rowsFor(data.guests.averagePartySize, (v) => [["Average party size", "", v === null ? null : v.toFixed(2), null]]),
        ...rowsFor(data.guests.repeatGuestPct, (v) => [["Repeat guests (%)", "", pct(v), null]]),
        ...rowsFor(data.guests.countries, (v) => categories("Country", v, (n) => String(n))),
      ];
  }
}

export function csvFilename(data: AnalyticsData, section: SectionId): string {
  const slug = data.property.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${slug}-${section}-${data.range.from}-to-${data.range.to}.csv`;
}
