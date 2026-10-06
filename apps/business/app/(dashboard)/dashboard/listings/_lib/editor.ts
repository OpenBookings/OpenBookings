/**
 * Types shared by the listing editors (Property, Rooms). They share a shell —
 * section rail, save bar, publish switch — so they share the contracts that
 * shell is built on.
 */

/**
 * The shape every section's server action returns, consumed by useActionState.
 * `values` is echoed back so a rejected save re-renders what the host typed
 * rather than throwing it away.
 */
export interface FormState<T> {
  values: T;
  errors: Record<string, string[]> | null;
  success: boolean;
}

export interface SectionStatus {
  complete: boolean;
  /** Human-readable labels, printed directly in rail and publish tooltips. */
  missing: string[];
}
