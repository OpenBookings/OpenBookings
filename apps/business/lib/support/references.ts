/**
 * How support refers to things.
 *
 * Booking references are a placeholder until bookings get a real
 * host-facing reference: `#` plus the first 8 characters of the booking
 * UUID, always shown with the full UUID underneath or on hover. The support
 * bot accepts either form.
 *
 * Ticket references are Chatwoot's conversation display id (`#1234`), which
 * is also what the support team searches for in Chatwoot.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function shortBookingRef(bookingId: string): string {
  return `#${bookingId.slice(0, 8).toLowerCase()}`;
}

export function ticketRef(conversationId: number): string {
  return `#${conversationId}`;
}
