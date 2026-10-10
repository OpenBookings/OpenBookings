import {
  DEFAULT_PRESET,
  PERIOD_LABELS,
  resolvePeriod,
  type DateRange,
  type PeriodPreset,
} from "./period";
import type { ReadinessItem } from "./readiness";
import type { IsoDate } from "./types";

/** Why a page has nothing to show. Each has its own copy and its own single action. */
export type EmptyVariant = "not-live" | "no-bookings" | "filtered";

export interface EmptyAction {
  label: string;
  href: string;
}

/** Without these no guest can book at all; the other items only make a booking less likely. */
const BLOCKING_KEYS = ["listing", "payments"];

/** The widest preset: where "try a wider date range" leads when the default would show nothing new. */
const WIDEST_PRESET: PeriodPreset = "last-12-months";

/** The setup steps that are known to be open and stop every booking. */
export function blockers(readiness: ReadinessItem[]): ReadinessItem[] {
  return readiness.filter((item) => BLOCKING_KEYS.includes(item.key) && item.state === "todo");
}

/**
 * For a host who has never had a booking. A step we could not check is not a
 * blocker: an unreachable Stripe must not tell a live host they are not live.
 */
export function neverBookedVariant(readiness: ReadinessItem[]): "not-live" | "no-bookings" {
  return blockers(readiness).length > 0 ? "not-live" : "no-bookings";
}

/** The first step still open, blockers ahead of the rest. Null when nothing is known to be open. */
export function nextStep(readiness: ReadinessItem[]): ReadinessItem | null {
  return blockers(readiness)[0] ?? readiness.find((item) => item.state === "todo") ?? null;
}

const covers = (outer: DateRange, inner: DateRange): boolean =>
  outer.from <= inner.from && outer.to >= inner.to;

/**
 * The one action for a period that holds nothing: back to the default, or on
 * to the widest preset when the default lies inside the period on screen and
 * so is known to be empty too. Null when the widest is inside it as well:
 * no link is better than one that leads to another empty page.
 */
export function filteredAction(
  path: string,
  search: URLSearchParams,
  period: DateRange,
  today: IsoDate,
): EmptyAction | null {
  const params = new URLSearchParams(search);
  for (const key of ["period", "from", "to"]) params.delete(key);

  const reset = !covers(period, resolvePeriod(DEFAULT_PRESET, today));
  if (!reset) {
    if (covers(period, resolvePeriod(WIDEST_PRESET, today))) return null;
    params.set("period", WIDEST_PRESET);
  }

  const query = params.toString();
  return {
    label: reset ? "Reset filters" : `Show ${PERIOD_LABELS[WIDEST_PRESET].toLowerCase()}`,
    href: query ? `${path}?${query}` : path,
  };
}
