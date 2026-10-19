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
/** Typing indicator toggles, kept apart so call-order assertions above stay readable. */
export const typingCalls: Array<{ conversationId: number; on: boolean }> = [];

/** Raw SQL the code under test ran through `query`, with a scripted result per call. */
export const sqlCalls: Array<{ text: string; values: unknown[] }> = [];
export const sqlResults: unknown[][] = [];

/** In-memory support_tickets keyed by conversation id (the webhook's view). */
export type FakeTicket = {
  id: string;
  organization_id: string;
  opened_by_user_id: string | null;
  status: string;
  last_message_at?: Date | null;
  last_message_sender?: string | null;
  last_message_preview?: string | null;
  handed_off_at?: Date | null;
  resolved_at?: Date | null;
};
export const supportTickets = new Map<number, FakeTicket>();
/** Rows the backfill was asked to insert. */
export const backfills: unknown[] = [];
/** What claimSupportReplyNotification returns next (null = nothing to send). */
export const replyClaims: Array<{ ticket_id: string; conversation_id: number; email: string; name: string | null } | null> = [];

export function resetMocks(): void {
  processedEvents.clear();
  contextCache.clear();
  reservations.clear();
  chatwootCalls.length = 0;
  typingCalls.length = 0;
  sqlCalls.length = 0;
  sqlResults.length = 0;
  supportTickets.clear();
  backfills.length = 0;
  replyClaims.length = 0;
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
    stripe_account_id: "acct_test",
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
  // Host lookups (src/host/queries.ts) go through raw SQL; tests script the
  // rows and assert the scoping in the statement text.
  query: async (text: string, values: unknown[] = []) => {
    sqlCalls.push({ text, values });
    return sqlResults.shift() ?? [];
  },
  // Imported by @openbookings/authz at load; the bot only uses its SQL helpers.
  queryOne: async (text: string, values: unknown[] = []) => {
    sqlCalls.push({ text, values });
    return (sqlResults.shift() ?? [])[0] ?? null;
  },

  // support_tickets surface used by the support webhook.
  supportPreview: (content: string | null | undefined) => {
    const line = (content ?? "").replace(/\s+/g, " ").trim();
    return line || null;
  },
  isSupportTicketStatus: (v: unknown) =>
    typeof v === "string" && ["pending", "open", "snoozed", "resolved"].includes(v),
  findSupportTicketByConversation: async (conversationId: number) => supportTickets.get(conversationId) ?? null,
  backfillSupportTicket: async (row: unknown) => {
    backfills.push(row);
    return true;
  },
  applySupportTicketStatus: async (conversationId: number, status: string, at: Date) => {
    const t = supportTickets.get(conversationId);
    if (!t) return false;
    if ((status === "open" || status === "snoozed") && t.status === "pending" && !t.handed_off_at) t.handed_off_at = at;
    if (status === "resolved") t.resolved_at = at;
    t.status = status;
    return true;
  },
  recordSupportTicketMessage: async (
    conversationId: number,
    m: { at: Date; content: string | null; sender: string },
  ) => {
    const t = supportTickets.get(conversationId);
    if (!t) return null;
    if (t.last_message_at && t.last_message_at > m.at) return null;
    t.last_message_at = m.at;
    t.last_message_sender = m.sender;
    t.last_message_preview = m.content;
    return { id: t.id, opened_by_user_id: t.opened_by_user_id };
  },
  claimSupportReplyNotification: async () => replyClaims.shift() ?? null,

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
  // Same two writes as the real @openbookings/support implementation.
  handOffToHuman: async (conversationId: number, note: string) => {
    chatwootCalls.push({ kind: "note", conversationId, content: note });
    chatwootCalls.push({ kind: "status", conversationId, status: "open" });
  },
  setTypingStatus: async (conversationId: number, on: boolean) => {
    typingCalls.push({ conversationId, on });
  },
}));
