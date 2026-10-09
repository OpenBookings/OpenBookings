import { DEFAULT_PRESET, PERIOD_LABELS, type PeriodPreset } from "./period";
import type { ReadinessItem } from "./readiness";

/** Why a page has nothing to show. Each has its own copy and its own single action. */
export type EmptyVariant = "not-live" | "no-bookings" | "filtered";

export interface EmptyAction {
  label: string;
  href: string;
}

/** Without these no guest can book at all; the other items only make a booking less likely. */
const BLOCKING_KEYS = ["listing", "payments"];

/** The widest preset: where "try a wider date range" leads when nothing was narrowed. */
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

/**
 * The one action for a period that holds nothing. A narrowed period goes back
 * to the default; the default, which has nothing to reset, widens instead.
 */
export function filteredAction(path: string, search: URLSearchParams): EmptyAction {
  const params = new URLSearchParams(search);
  const requested = params.get("period");
  const narrowed = requested !== null && requested !== DEFAULT_PRESET;
  for (const key of ["period", "from", "to"]) params.delete(key);
  if (!narrowed) params.set("period", WIDEST_PRESET);

  const query = params.toString();
  return {
    label: narrowed ? "Reset filters" : `Show ${PERIOD_LABELS[WIDEST_PRESET].toLowerCase()}`,
    href: query ? `${path}?${query}` : path,
  };
}
