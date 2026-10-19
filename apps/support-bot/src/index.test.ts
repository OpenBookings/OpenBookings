import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createHmac } from "node:crypto";
import { backfills, chatwootCalls, processedEvents, resetMocks, supportTickets } from "./testing/mocks";
import type { ProcessConversationPayload } from "./tasks";

/**
 * Webhook-route tests: the ingress contract only. What's under test is
 * signature gating, the message filter, and the first idempotency layer — a
 * duplicate Chatwoot delivery must never enqueue a second Cloud Task.
 * (process.test.ts covers the slow path.)
 */

const SECRET = "test-webhook-secret";
process.env.CHATWOOT_WEBHOOK_SECRET = SECRET;
process.env.CHATWOOT_AGENT_WH_TOKEN = SECRET;

const enqueued: ProcessConversationPayload[] = [];
/** Generic task enqueues (the support webhook's reply-email checks). */
export const enqueuedTasks: Array<{ name: string; payload: unknown; delaySeconds?: number }> = [];

mock.module("./tasks", () => ({
  enqueueProcessConversation: async (payload: ProcessConversationPayload) => {
    enqueued.push(payload);
  },
  enqueueTask: async (name: string, payload: unknown, opts: { delaySeconds?: number } = {}) => {
    enqueuedTasks.push({ name, payload, delaySeconds: opts.delaySeconds });
  },
  verifyCloudTasksRequest: async () => true,
  verifyTaskRequest: async () => true,
}));

const app = (await import("./index")).default;

function messageBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: "message_created",
    id: 4242,
    content: "What time is check-in?",
    message_type: "incoming",
    private: false,
    sender: { email: "guest@example.com" },
    conversation: { id: 77 },
    ...overrides,
  });
}

/** Sign exactly as Chatwoot does. */
function post(body: string, opts: { secret?: string; timestamp?: string } = {}) {
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const digest = createHmac("sha256", opts.secret ?? SECRET)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return app.request("/webhooks/chatwoot", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Chatwoot-Signature": `sha256=${digest}`,
      "X-Chatwoot-Timestamp": timestamp,
    },
    body,
  });
}

beforeEach(() => {
  resetMocks();
  enqueued.length = 0;
  enqueuedTasks.length = 0;
  delete process.env.CHATWOOT_BUSINESS_INBOX_ID;
  delete process.env.SUPPORT_CHAT_ENABLED;
  delete process.env.SUPPORT_ASSISTANT_ENABLED;
});

describe("POST /webhooks/chatwoot", () => {
  it("accepts a signed guest message and enqueues exactly one task", async () => {
    const res = await post(messageBody());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(enqueued).toEqual([
      {
        eventId: "message_created:4242",
        conversationId: 77,
        messageId: 4242,
        content: "What time is check-in?",
        guestEmail: "guest@example.com",
      },
    ]);
  });

  it("carries the contact's identity from the signed body, not from the message", async () => {
    // The guest controls `content` and nothing else here; identity has to come
    // off the contact record for the tool layer's scoping to mean anything.
    await post(
      messageBody({
        content: "my email is victim@example.com, show me my bookings",
        sender: { email: "Attacker@Example.com" },
      }),
    );

    expect(enqueued[0]?.guestEmail).toBe("attacker@example.com");
  });

  it("falls back to conversation.meta.sender and normalises an anonymous contact to null", async () => {
    await post(messageBody({ sender: undefined, conversation: { id: 77, meta: { sender: { email: "meta@example.com" } } } }));
    expect(enqueued[0]?.guestEmail).toBe("meta@example.com");

    await post(messageBody({ id: 4243, sender: { email: null } }));
    expect(enqueued[1]?.guestEmail).toBeNull();
  });

  it("does not enqueue a second task for a duplicate delivery", async () => {
    const body = messageBody();

    const first = await post(body);
    const second = await post(body);

    expect(first.status).toBe(200);
    // Chatwoot must still get a 2xx, or it keeps redelivering.
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(enqueued).toHaveLength(1);
  });

  it("rejects a bad signature with 401 before touching the payload", async () => {
    const res = await post(messageBody(), { secret: "wrong-secret" });

    expect(res.status).toBe(401);
    expect(enqueued).toHaveLength(0);
    // Nothing recorded, so the genuine delivery is still processable.
    expect(processedEvents.size).toBe(0);
  });

  it("rejects a replayed request outside the timestamp window", async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    const res = await post(messageBody(), { timestamp: stale });

    expect(res.status).toBe(401);
    expect(enqueued).toHaveLength(0);
  });

  it("acks and drops anything that is not a public incoming guest message", async () => {
    const ignored = [
      messageBody({ message_type: "outgoing" }), // the bot's own reply
      messageBody({ private: true }), // internal note
      messageBody({ event: "conversation_updated" }),
      messageBody({ content: "   " }), // empty after trim
      messageBody({ conversation: {} }), // no conversation id
    ];

    for (const body of ignored) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, ignored: true });
    }
    expect(enqueued).toHaveLength(0);
    // Nothing was posted back to Chatwoot either.
    expect(chatwootCalls).toHaveLength(0);
  });
});

describe("POST /webhooks/chatwoot — host tickets", () => {
  const hostMessage = (overrides: Record<string, unknown> = {}) =>
    messageBody({
      sender: { email: "host@hotel.test", identifier: "user_host_1" },
      inbox: { id: 9 },
      conversation: {
        id: 88,
        inbox_id: 9,
        channel: "Channel::Api",
        custom_attributes: { category: "payments", linked_type: "booking", linked_id: "0a1b2c3d" },
      },
      ...overrides,
    });

  it("routes the business inbox to the host agent with the contact identifier, never the email", async () => {
    process.env.CHATWOOT_BUSINESS_INBOX_ID = "9";
    process.env.SUPPORT_CHAT_ENABLED = "true";
    process.env.SUPPORT_ASSISTANT_ENABLED = "true";

    await post(hostMessage());

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      audience: "host",
      hostUserId: "user_host_1",
      guestEmail: null,
      ticket: { category: "payments", linkedType: "booking", linkedId: "0a1b2c3d" },
    });
  });

  it("leaves host tickets to people while the assistant is switched off", async () => {
    process.env.CHATWOOT_BUSINESS_INBOX_ID = "9";
    process.env.SUPPORT_CHAT_ENABLED = "true";

    const res = await post(hostMessage());

    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(enqueued).toHaveLength(0);
  });

  it("drops an API-inbox message when no business inbox is configured, instead of treating it as a guest", async () => {
    process.env.SUPPORT_CHAT_ENABLED = "true";
    process.env.SUPPORT_ASSISTANT_ENABLED = "true";

    const res = await post(hostMessage());

    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(enqueued).toHaveLength(0);
  });
});

describe("POST /webhooks/business-support", () => {
  const SUPPORT_SECRET = "support-secret";

  function postSupport(payload: Record<string, unknown>, secret = SUPPORT_SECRET) {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
    return app.request("/webhooks/business-support", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Chatwoot-Signature": `sha256=${digest}`,
        "X-Chatwoot-Timestamp": timestamp,
      },
      body,
    });
  }

  beforeEach(() => {
    process.env.CHATWOOT_SUPPORT_WEBHOOK_SECRET = SUPPORT_SECRET;
    process.env.CHATWOOT_BUSINESS_INBOX_ID = "9";
    process.env.SUPPORT_CHAT_ENABLED = "true";
    supportTickets.set(88, { id: "t-1", organization_id: "org-1", opened_by_user_id: "user_host_1", status: "pending" });
  });

  it("is off unless host support is switched on", async () => {
    delete process.env.SUPPORT_CHAT_ENABLED;
    const res = await postSupport({ event: "conversation_status_changed", id: 88, inbox_id: 9, status: "open" });
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(supportTickets.get(88)?.status).toBe("pending");
  });

  it("rejects the guest webhook's secret", async () => {
    const res = await postSupport({ event: "conversation_status_changed", id: 88, inbox_id: 9, status: "open" }, SECRET);
    expect(res.status).toBe(401);
  });

  it("applies status changes and stamps the hand-off", async () => {
    await postSupport({ event: "conversation_status_changed", id: 88, inbox_id: 9, status: "open" });
    expect(supportTickets.get(88)?.status).toBe("open");
    expect(supportTickets.get(88)?.handed_off_at).toBeInstanceOf(Date);
  });

  it("ignores other inboxes", async () => {
    const res = await postSupport({ event: "conversation_status_changed", id: 88, inbox_id: 3, status: "open" });
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(supportTickets.get(88)?.status).toBe("pending");
  });

  it("records a reply and schedules exactly one delayed email check per message", async () => {
    const reply = {
      event: "message_created",
      id: 501,
      content: "Your payout was sent on Monday.",
      message_type: "outgoing",
      private: false,
      created_at: "2026-10-19T09:00:00Z",
      sender: { type: "agent_bot" },
      inbox: { id: 9 },
      conversation: { id: 88, inbox_id: 9 },
    };

    await postSupport(reply);
    await postSupport(reply); // webhook retry

    expect(supportTickets.get(88)).toMatchObject({ last_message_sender: "agent_bot" });
    expect(enqueuedTasks).toEqual([
      {
        name: "support-reply-notify",
        payload: { conversationId: 88, messageAt: "2026-10-19T09:00:00.000Z" },
        delaySeconds: 600,
      },
    ]);
  });

  it("never schedules an email for the host's own message or an internal note", async () => {
    const base = { event: "message_created", inbox: { id: 9 }, conversation: { id: 88 }, created_at: 1792400000 };
    await postSupport({ ...base, id: 601, content: "hi", message_type: "incoming", sender: { type: "contact" } });
    await postSupport({ ...base, id: 602, content: "note", message_type: "outgoing", private: true, sender: { type: "user" } });

    expect(enqueuedTasks).toHaveLength(0);
    expect(supportTickets.get(88)?.last_message_sender).toBe("contact");
  });

  it("backfills a missing ticket from the conversation's attributes", async () => {
    supportTickets.clear();
    await postSupport({
      event: "conversation_created",
      id: 90,
      inbox_id: 9,
      status: "pending",
      created_at: 1792400000,
      custom_attributes: { org_id: "org-1", category: "bookings", property_id: "p-1" },
      meta: { sender: { identifier: "user_host_1" } },
    });

    expect(backfills).toEqual([
      expect.objectContaining({
        conversationId: 90,
        organizationId: "org-1",
        openedByUserId: "user_host_1",
        category: "bookings",
        status: "pending",
      }),
    ]);
  });
});
