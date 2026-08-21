import { mock } from "bun:test";
import type { CachedTurn, SupportReservation } from "@openbookings/db";

/**
 * Shared test doubles for `@openbookings/db` and the Chatwoot client.
 *
 * `mock.module` is process-global and `bun test` runs every file in one
 * process, so each test file registering its own partial mock would clobber
 * the others (whichever ran last would win, and imports of the names it
 * omitted would fail to resolve). Registering the full surface exactly once,
 * here, keeps the doubles consistent no matter which files run together.
 *
 * Import this module before importing the code under test, and call
 * `resetMocks()` in `beforeEach`.
 */

export type ChatwootCall =
  | { kind: "reply"; conversationId: number; content: string }
  | { kind: "note"; conversationId: number; content: string }
  | { kind: "status"; conversationId: number; status: string }
  | { kind: "incoming"; conversationId: number; content: string };

/** The two fields a test actually varies; the rest of the row is filled in. */
export type FakeReservation = { bookingId: string; guestEmail: string | null };

/** In-memory stand-in for the processed_events table. */
export const processedEvents = new Map<string, { repliedAt: boolean }>();
/** In-memory stand-in for support_context_cache. */
export const contextCache = new Map<number, CachedTurn[]>();
/** In-memory stand-in for the bookings a reservation lookup can reach, by reference. */
export const reservations = new Map<string, FakeReservation>();
/** Every write the pipeline made to Chatwoot, in order. */
export const chatwootCalls: ChatwootCall[] = [];

export function resetMocks(): void {
  processedEvents.clear();
  contextCache.clear();
  reservations.clear();
  chatwootCalls.length = 0;
  nextIncomingId = 9000;
}

/** Expand a fixture into the full row shape the tools destructure. */
function reservationRow(fake: FakeReservation): SupportReservation {
  return {
    booking_id: fake.bookingId,
    status: "confirmed",
    check_in_date: "2026-09-01",
    check_out_date: "2026-09-03",
    check_in_time: "15:00:00",
    check_out_time: "11:00:00",
    total_amount: 32500,
    currency: "eur",
    stripe_payment_intent_id: "pi_test",
    cancellation_reason: null,
    cancelled_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    guest_email: fake.guestEmail,
    property_name: "Test Villa",
    property_city: "Amsterdam",
    property_country: "NL",
    rooms: [
      {
        room_name: "Suite",
        rate_plan_name: "Standard",
        is_refundable: true,
        cancellation_policy: "Flexible",
        adults: 2,
        children: 0,
        total_nights: 2,
        price_per_night: 16250,
        total_amount: 32500,
      },
    ],
  };
}

mock.module("@openbookings/db", () => ({
  // Mirrors INSERT ... ON CONFLICT DO NOTHING RETURNING: true only for the
  // insert that actually won the race.
  recordProcessedEvent: async (eventId: string) => {
    if (processedEvents.has(eventId)) return false;
    processedEvents.set(eventId, { repliedAt: false });
    return true;
  },
  hasRepliedToEvent: async (eventId: string) => processedEvents.get(eventId)?.repliedAt === true,
  markEventReplied: async (eventId: string) => {
    processedEvents.set(eventId, { repliedAt: true });
  },

  getConversationCache: async (conversationId: number) => contextCache.get(conversationId) ?? null,
  setConversationCache: async (conversationId: number, turns: CachedTurn[]) => {
    contextCache.set(conversationId, turns);
  },

  // Imported by agent/tools.ts at module load. These mirror the SQL contract
  // the real queries have: reference lookup is *unscoped* (it can return any
  // guest's booking — authorization is the tool layer's job, and these doubles
  // must not paper over that), email lookup is scoped and case-insensitive.
  findReservationByReference: async (bookingReference: string) => {
    const fake = reservations.get(bookingReference.trim());
    return fake ? reservationRow(fake) : null;
  },
  findReservationsByGuestEmail: async (guestEmail: string) => {
    const wanted = guestEmail.trim().toLowerCase();
    return [...reservations.values()]
      .filter((r) => r.guestEmail?.trim().toLowerCase() === wanted)
      .map(reservationRow);
  },
}));

/** Ids Chatwoot hands back for created guest messages — distinctive on sight. */
let nextIncomingId = 9000;

mock.module("../chatwoot/client", () => ({
  getConversationMessages: async () => [],
  // Only the dev console calls this; the bot never posts as the guest.
  postIncomingMessage: async (conversationId: number, content: string) => {
    chatwootCalls.push({ kind: "incoming", conversationId, content });
    return { id: ++nextIncomingId, content, message_type: 0, private: false, created_at: 0 };
  },
  postReply: async (conversationId: number, content: string) => {
    chatwootCalls.push({ kind: "reply", conversationId, content });
  },
  postPrivateNote: async (conversationId: number, content: string) => {
    chatwootCalls.push({ kind: "note", conversationId, content });
  },
  setConversationStatus: async (conversationId: number, status: string) => {
    chatwootCalls.push({ kind: "status", conversationId, status });
  },
}));
