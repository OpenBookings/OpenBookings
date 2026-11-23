/**
 * The booking reference people see: `OB-` plus the first 8 characters of the
 * booking UUID in two groups, e.g. `b7b02a1c-52c4-…` → `OB-B7B0-2A1C`.
 *
 * The reference is derived, never stored. Migration 0056 keeps it unique: new
 * booking ids come from app.new_booking_id(), which skips any UUID whose first
 * 8 characters are taken, and a unique index on left(id::text, 8) refuses a
 * duplicate outright. So the 8-character prefix identifies exactly one booking.
 *
 * Kept free of imports so client components can use it
 * (`@openbookings/db/booking-reference`).
 */

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/;

/** `OB-B7B0-2A1C` for booking id `b7b02a1c-…`. */
export function bookingReference(bookingId: string): string {
  const head = bookingId.slice(0, 8).toUpperCase();
  return `OB-${head.slice(0, 4)}-${head.slice(4)}`;
}

/**
 * Read a booking reference however someone typed or pasted it: `OB-B7B0-2A1C`,
 * `ob b7b02a1c`, `#b7b02a1c`, the old `B7B02A1C`, or the full UUID.
 *
 * Returns the lowercase 8-character prefix, or the full lowercase UUID when one
 * was given, or null when the input can't be a booking reference. The result is
 * only ever hex and dashes, so it is safe inside a LIKE pattern.
 */
export function parseBookingReference(raw: string): string | null {
  let ref = raw.trim().toLowerCase().replace(/^#/, "");
  if (UUID_RE.test(ref)) {
    const hex = ref.replace(/-/g, "");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  ref = ref.replace(/[\s-]/g, "").replace(/^ob/, "");
  // Hex has no O, I or L, so those can only be a misread 0 or 1.
  ref = ref.replace(/o/g, "0").replace(/[il]/g, "1");
  return /^[0-9a-f]{8}$/.test(ref) ? ref : null;
}

/**
 * SQL that matches a booking id column against a parsed reference parameter
 * (an 8-character prefix or a full UUID). Uses the 0056 unique index.
 */
export function bookingReferenceMatchSql(idColumn: string, param: string): string {
  return `left(${idColumn}::text, 8) = left(${param}, 8) AND starts_with(${idColumn}::text, ${param})`;
}
