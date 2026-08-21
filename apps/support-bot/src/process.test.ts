import { beforeEach, describe, expect, it } from "bun:test";
import { chatwootCalls, processedEvents, resetMocks } from "./testing/mocks";
import type { ChatFn, ChatResponse } from "./agent/loop";

/**
 * Async-processor tests. The DB and the Chatwoot API are mocked so the whole
 * pipeline runs offline; what's under test is the second idempotency layer
 * (a Cloud Tasks retry must not double-post to the guest) and that both
 * escalation paths — rule-based and model-driven — leave the conversation in
 * the same state.
 */

const { processConversation } = await import("./process");

/** A chat fn that replays a fixed script and counts how often it was called. */
function scriptedChat(responses: ChatResponse[]) {
  const remaining = [...responses];
  let calls = 0;
  const chat: ChatFn = async () => {
    calls++;
    const next = remaining.shift();
    if (!next) throw new Error("scripted chat exhausted");
    return next;
  };
  return Object.assign(chat, { callCount: () => calls });
}

function toolCall(name: string, args: unknown, id = "c1") {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

const EVENT_ID = "message_created:1";

const payload = (overrides: Record<string, unknown> = {}) => ({
  eventId: EVENT_ID,
  conversationId: 77,
  messageId: 1,
  content: "What time is check-in?",
  guestEmail: "guest@example.com",
  ...overrides,
});

/** The observable hand-off state, independent of the reason text. */
function handoffState() {
  return {
    postedPublicReply: chatwootCalls.some((c) => c.kind === "reply"),
    postedPrivateNote: chatwootCalls.some((c) => c.kind === "note"),
    status: chatwootCalls.find((c) => c.kind === "status")?.status ?? null,
    eventMarkedReplied: processedEvents.get(EVENT_ID)?.repliedAt === true,
  };
}

const ESCALATED = {
  postedPublicReply: false,
  postedPrivateNote: true,
  status: "open",
  eventMarkedReplied: true,
};

beforeEach(resetMocks);

describe("processConversation idempotency", () => {
  it("posts one guest reply and marks the event replied", async () => {
    const chat = scriptedChat([{ content: "Check-in is from 15:00." }]);

    await processConversation(payload(), { chat });

    expect(chatwootCalls).toEqual([
      { kind: "reply", conversationId: 77, content: "Check-in is from 15:00." },
    ]);
    expect(processedEvents.get(EVENT_ID)?.repliedAt).toBe(true);
  });

  it("does not post a second reply when Cloud Tasks retries the same task", async () => {
    await processConversation(payload(), {
      chat: scriptedChat([{ content: "Check-in is from 15:00." }]),
    });

    // Retry of the identical task body.
    const retry = scriptedChat([{ content: "Check-in is from 15:00." }]);
    await processConversation(payload(), { chat: retry });

    expect(chatwootCalls.filter((c) => c.kind === "reply")).toHaveLength(1);
    // The retry short-circuits before spending a Mistral call.
    expect(retry.callCount()).toBe(0);
  });

  it("does not re-escalate when a retried task had already escalated", async () => {
    const content = "I want to talk to a human";
    await processConversation(payload({ content }), {
      chat: scriptedChat([
        { content: null, toolCalls: [toolCall("escalate_to_human", { reason: "Guest asked" })] },
      ]),
    });
    expect(chatwootCalls.filter((c) => c.kind === "note")).toHaveLength(1);

    const retry = scriptedChat([]);
    await processConversation(payload({ content }), { chat: retry });

    expect(retry.callCount()).toBe(0);
    expect(chatwootCalls.filter((c) => c.kind === "note")).toHaveLength(1);
    expect(chatwootCalls.filter((c) => c.kind === "status")).toHaveLength(1);
  });
});

describe("escalation hand-off parity", () => {
  it("produces the same hand-off state whether the rule or the model escalates", async () => {
    // Rule-based: dispute vocabulary short-circuits before any model call.
    const ruleChat = scriptedChat([]);
    await processConversation(payload({ content: "I've started a chargeback with my bank" }), {
      chat: ruleChat,
    });
    const ruleState = handoffState();
    const ruleNote = chatwootCalls.find((c) => c.kind === "note")!;

    expect(ruleChat.callCount()).toBe(0); // Mistral never called.

    resetMocks();

    // Model-driven: the same hand-off, reached through the tool call.
    await processConversation(payload({ content: "Let me talk to someone" }), {
      chat: scriptedChat([
        { content: null, toolCalls: [toolCall("escalate_to_human", { reason: "Guest wants a person" })] },
      ]),
    });
    const modelState = handoffState();
    const modelNote = chatwootCalls.find((c) => c.kind === "note")!;

    expect(modelState).toEqual(ruleState);
    expect(ruleState).toEqual(ESCALATED);

    // Same note shape both ways; only the reason line differs.
    for (const note of [ruleNote, modelNote]) {
      expect(note.content).toContain("**Support bot escalation**");
      expect(note.content).toContain("**Reason:**");
    }
    expect(ruleNote.content).toContain("chargeback");
    expect(modelNote.content).toContain("Guest wants a person");
  });

  it("escalates without replying when the loop hits the iteration cap", async () => {
    const endless: ChatResponse = {
      content: null,
      toolCalls: [toolCall("get_reservation", { booking_reference: "not-a-uuid" })],
    };

    await processConversation(payload({ content: "where is my booking" }), {
      chat: scriptedChat(Array(100).fill(endless)),
    });

    expect(handoffState()).toEqual(ESCALATED);
  });
});
