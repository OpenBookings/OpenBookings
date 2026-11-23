/**
 * How support refers to things.
 *
 * Booking references are `OB-XXXX-XXXX` (see @openbookings/db/booking-reference),
 * unique per booking. The support bot accepts that, the old 8-character form
 * and the full UUID.
 *
 * Ticket references are Chatwoot's conversation display id (`#1234`), which
 * is also what the support team searches for in Chatwoot.
 */

import { bookingReference } from "@openbookings/db/booking-reference";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function shortBookingRef(bookingId: string): string {
  return bookingReference(bookingId);
}

export function ticketRef(conversationId: number): string {
  return `#${conversationId}`;
}
