import { IsoDateSchema, MAX_ARI_SPAN_DAYS } from "@openbookings/apps-contract";
import { type OtaError, invalidRequest } from "../soap/errors";

/** Shared reading of the parsed OTA notif messages: the parser gives one child as an object, several as an array. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const asArray = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
/** A parsed self-closing element without attributes is "", not an object: read it as having no attributes. */
export const asNode = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
export const attr = (node: Record<string, unknown>, name: string): string | undefined => {
  const v = node[`@_${name}`];
  return typeof v === "string" ? v : undefined;
};
export const fail = (message: string): { error: OtaError } => ({ error: invalidRequest(message) });

/** The single element `name` under `parent`, or undefined when it is missing or repeated. */
export function single(parent: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const nodes = asArray(parent[name]);
  return nodes.length === 1 ? asNode(nodes[0]) : undefined;
}

// Proleptic Gregorian day numbers with integer arithmetic only (days_from_civil / civil_from_days,
// H. Hinnant): no JS Date, so no time zone can shift a calendar date.
function dayNumber(iso: string): number {
  const [y0, m, d] = iso.split("-").map(Number) as [number, number, number];
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function isoDate(day: number): string {
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// OTA's day-of-week pattern attributes (and their common misspellings). SiteMinder's docs define none.
const WEEKDAY_ATTRIBUTES = ["Mon", "Tue", "Wed", "Weds", "Thu", "Thur", "Fri", "Sat", "Sun"];

export type DateRange = { from: string; to: string };
export type StatusControl = { ranges: DateRange[]; invTypeCode?: string; ratePlanCode?: string };

/**
 * A message's `StatusApplicationControl`: inclusive `Start`/`End` become inclusive `from`/`to`, split into
 * spans of at most MAX_ARI_SPAN_DAYS so every change passes the Apps API's range check.
 */
export function statusControl(message: Record<string, unknown>): StatusControl | { error: OtaError } {
  const control = single(message, "StatusApplicationControl");
  if (!control) return fail("Node StatusApplicationControl must occur once");
  // A weekday pattern would limit the range to some days; applying it to every day would be wrong.
  const weekday = WEEKDAY_ATTRIBUTES.find((day) => control[`@_${day}`] !== undefined);
  if (weekday) return fail(`Attribute ${weekday} on StatusApplicationControl is not supported`);

  const start = attr(control, "Start");
  const end = attr(control, "End");
  if (start === undefined) return fail("Attribute Start must exist");
  if (end === undefined) return fail("Attribute End must exist");
  if (!IsoDateSchema.safeParse(start).success) return fail(`Start must be a date (YYYY-MM-DD), got "${start}"`);
  if (!IsoDateSchema.safeParse(end).success) return fail(`End must be a date (YYYY-MM-DD), got "${end}"`);
  const first = dayNumber(start);
  const last = dayNumber(end);
  if (last < first) return fail("End must not be before Start");

  const ranges: DateRange[] = [];
  for (let from = first; from <= last; from += MAX_ARI_SPAN_DAYS) {
    ranges.push({ from: isoDate(from), to: isoDate(Math.min(from + MAX_ARI_SPAN_DAYS - 1, last)) });
  }
  const invTypeCode = attr(control, "InvTypeCode");
  const ratePlanCode = attr(control, "RatePlanCode");
  return {
    ranges,
    ...(invTypeCode ? { invTypeCode } : {}),
    ...(ratePlanCode ? { ratePlanCode } : {}),
  };
}
