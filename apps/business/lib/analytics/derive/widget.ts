import type { Basis, Widget } from "../types";

/**
 * Builds one widget. Below its minimum sample it declines and says how far
 * short it is; a derivation that throws is contained here so its neighbours
 * still render. The message is fixed: an error's own text does not reach a host.
 */
export function widget<T>(basis: Basis, sample: number, compute: () => T, min = 0): Widget<T> {
  if (sample < min) return { ok: false, reason: "below-minimum", basis, needed: min, have: sample };
  try {
    return { ok: true, value: compute(), basis, sample };
  } catch {
    return { ok: false, reason: "error", message: "We could not work this one out." };
  }
}
