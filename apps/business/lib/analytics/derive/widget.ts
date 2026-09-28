import type { Widget } from "../types";

/**
 * Runs one widget's derivation and contains anything it throws, so a single bad
 * division cannot take the other nineteen widgets down with it. The message
 * reaches the host, so it stays short and does not carry a stack.
 */
export function widget<T>(compute: () => T): Widget<T> {
  try {
    return { ok: true, value: compute() };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}

export function unwrapOr<T>(result: Widget<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
