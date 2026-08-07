import { mock } from "bun:test";
import type { CachedTurn } from "@openbookings/db";

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

/** In-memory stand-in for the processed_events table. */
export const processedEvents = new Map<string, { repliedAt: boolean }>();
/** In-memory stand-in for support_context_cache. */
export const contextCache = new Map<number, CachedTurn[]>();
/** Every write the pipeline made to Chatwoot, in order. */
export const chatwootCalls: ChatwootCall[] = [];

export function resetMocks(): void {
  processedEvents.clear();
  contextCache.clear();
  chatwootCalls.length = 0;
  nextIncomingId = 9000;
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

  // Imported by agent/tools.ts at module load. Tests that need reservation
  // data script the chat around them rather than exercising SQL.
  findReservationByReference: async () => null,
  findReservationsByGuestEmail: async () => [],
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
