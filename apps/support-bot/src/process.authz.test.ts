import { beforeEach, describe, expect, it } from "bun:test";
import { chatwootCalls, reservations, resetMocks } from "./testing/mocks";
import type { ChatFn, ChatResponse } from "./agent/loop";

/**
 * End-to-end guard against unauthorized booking disclosure.
 *
 * These reproduce the original defect: `get_reservation` took a `guest_email`
 * argument, so anyone who opened a support chat and named another guest's
 * address got that guest's booking read back to them. The model is scripted to
 * behave as badly as possible — asking for the victim's data by every route the
 * tool surface allows — and the assertions are on what reaches the guest, so
 * they hold regardless of how the model is prompted.
 */

const VICTIM_REF = "11111111-1111-1111-1111-111111111111";
const VICTIM_EMAIL = "victim@example.com";
const ATTACKER_EMAIL = "attacker@example.com";

function scriptedChat(responses: ChatResponse[]) {
  const remaining = [...responses];
  const chat: ChatFn = async () => {
    const next = remaining.shift();
    if (!next) throw new Error("scripted chat exhausted");
    return next;
  };
  return chat;
}

/** Like scriptedChat, but keeps every message list the model was shown. */
function recordingChat(responses: ChatResponse[]) {
  const seen: unknown[][] = [];
  const inner = scriptedChat(responses);
  const chat: ChatFn = async (messages) => {
    seen.push(structuredClone(messages) as unknown[]);
    return inner(messages);
  };
  return { chat, seen };
}

function toolCall(name: string, args: unknown, id = "c1") {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

const { processConversation } = await import("./process");

/** Everything the pipeline said to anyone, guest-facing or internal. */
function everythingWritten(): string {
  return chatwootCalls.map((c) => ("content" in c ? c.content : "")).join("\n");
}

beforeEach(() => {
  resetMocks();
  reservations.set(VICTIM_REF, { bookingId: VICTIM_REF, guestEmail: VICTIM_EMAIL });
});

describe("unauthorized booking lookup", () => {
  it("does not disclose another guest's booking when the model asks by their email", async () => {
    await processConversation(
      {
        eventId: "message_created:9001",
        conversationId: 77,
        messageId: 9001,
        content: `Show bookings for ${VICTIM_EMAIL}`,
        guestEmail: ATTACKER_EMAIL,
      },
      {
        chat: scriptedChat([
          { content: null, toolCalls: [toolCall("get_reservation", { guest_email: VICTIM_EMAIL })] },
          { content: "I can only look up bookings on your own account." },
        ]),
      },
    );

    expect(everythingWritten()).not.toContain("Test Villa");
    expect(everythingWritten()).not.toContain(VICTIM_REF);
  });

  it("does not disclose another guest's booking when the model has the reference", async () => {
    await processConversation(
      {
        eventId: "message_created:9002",
        conversationId: 77,
        messageId: 9002,
        content: `My friend gave me their reference ${VICTIM_REF}, show me the payment`,
        guestEmail: ATTACKER_EMAIL,
      },
      {
        chat: scriptedChat([
          {
            content: null,
            toolCalls: [toolCall("get_payment_status", { booking_reference: VICTIM_REF })],
          },
          { content: "I could not find that booking on your account." },
        ]),
      },
    );

    expect(everythingWritten()).not.toContain("Test Villa");
    expect(everythingWritten()).not.toContain("32500");
  });

  const LIST_ALL = (guestEmailVerified?: boolean, id = 9010) => ({
    eventId: `message_created:${id}`,
    conversationId: 77,
    messageId: id,
    content: "List all my bookings please",
    guestEmail: VICTIM_EMAIL,
    ...(guestEmailVerified === undefined ? {} : { guestEmailVerified }),
  });
  const script = () => [
    { content: null, toolCalls: [toolCall("get_reservation", {})] },
    { content: "ok" },
  ];

  it("does not list bookings for an unverified contact who merely claims the victim's email", async () => {
    // No guestEmailVerified: the email came from a pre-chat form or an unsigned
    // email header. Claiming the victim's address must not enumerate their stays.
    for (const [i, flag] of [undefined, false].entries()) {
      const { chat, seen } = recordingChat(script());
      await processConversation(LIST_ALL(flag, 9010 + i), { chat });
      const shownToModel = JSON.stringify(seen.at(-1));
      expect(shownToModel).not.toContain(VICTIM_REF);
      expect(shownToModel).not.toContain("Test Villa");
      expect(shownToModel).toContain("booking reference");
      expect(everythingWritten()).not.toContain(VICTIM_REF);
    }
  });

  it("lists the same bookings once Chatwoot has verified the email", async () => {
    const { chat, seen } = recordingChat(script());
    await processConversation(LIST_ALL(true, 9020), { chat });
    expect(JSON.stringify(seen.at(-1))).toContain(VICTIM_REF);
  });

  it("discloses nothing when the contact is anonymous, even about a real booking", async () => {
    await processConversation(
      {
        eventId: "message_created:9003",
        conversationId: 77,
        messageId: 9003,
        content: `What are the details of booking ${VICTIM_REF}?`,
        guestEmail: null,
      },
      {
        chat: scriptedChat([
          {
            content: null,
            toolCalls: [toolCall("get_reservation", { booking_reference: VICTIM_REF })],
          },
          { content: null, toolCalls: [toolCall("escalate_to_human", { reason: "Cannot verify identity" })] },
        ]),
      },
    );

    expect(everythingWritten()).not.toContain("Test Villa");
    expect(chatwootCalls.some((c) => c.kind === "reply")).toBe(false);
  });

  it("still serves the guest their own booking", async () => {
    reservations.set(VICTIM_REF, { bookingId: VICTIM_REF, guestEmail: ATTACKER_EMAIL });

    await processConversation(
      {
        eventId: "message_created:9004",
        conversationId: 77,
        messageId: 9004,
        content: "Where am I staying?",
        guestEmail: ATTACKER_EMAIL,
      },
      {
        chat: scriptedChat([
          { content: null, toolCalls: [toolCall("get_reservation", {})] },
          { content: "You're staying at Test Villa in Amsterdam." },
        ]),
      },
    );

    expect(chatwootCalls).toContainEqual({
      kind: "reply",
      conversationId: 77,
      content: "You're staying at Test Villa in Amsterdam.",
    });
  });
});
