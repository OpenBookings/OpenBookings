import { beforeEach, describe, expect, it } from "bun:test";
import { chatwootCalls, resetMocks, sqlCalls, sqlResults, typingCalls } from "../testing/mocks";
import type { ChatFn, ChatResponse } from "../agent/loop";

const { HOST_AGENT, HOST_TOOLS } = await import("./tools");
const { normalizeBookingReference } = await import("./queries");
const { hostTicketNote } = await import("./prompt");
const { processConversation } = await import("../process");
const { renderSupportReplyEmail } = await import("../support/notify");
const { requiredAtStartup } = await import("../env");

const BOOKING_ID = "0a1b2c3d-1111-4222-8333-444455556666";

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    booking_id: BOOKING_ID,
    status: "confirmed",
    check_in_date: "2026-11-01",
    check_out_date: "2026-11-03",
    total_amount: 32500,
    booking_fee_amount: 0,
    currency: "EUR",
    stripe_payment_intent_id: null,
    stripe_account_id: null,
    cancellation_reason: null,
    cancelled_at: null,
    created_at: "2026-10-01T00:00:00Z",
    guest_name: "Emma de Vries",
    property_name: "Hotel Test",
    rooms: [],
    ...overrides,
  };
}

beforeEach(resetMocks);

describe("normalizeBookingReference", () => {
  it("accepts the full UUID and the short #prefix form", () => {
    expect(normalizeBookingReference(BOOKING_ID.toUpperCase())).toBe(BOOKING_ID);
    expect(normalizeBookingReference("#0A1B2C3D")).toBe("0a1b2c3d");
    expect(normalizeBookingReference(" 0a1b2c3d ")).toBe("0a1b2c3d");
  });

  it("refuses anything that can't be a booking id, so LIKE never sees a wildcard", () => {
    for (const bad of ["", "0a1b", "%", "0a1b2c3d%", "RES-1041", "'; drop table bookings; --"]) {
      expect(normalizeBookingReference(bad)).toBeNull();
    }
  });
});

describe("host tools", () => {
  const ctx = { hostUserId: "user_host_1" };

  it("scopes every lookup to the context host's readable properties", async () => {
    sqlResults.push([bookingRow()]);
    const result = await HOST_TOOLS.get_booking.execute({ booking_reference: "#0a1b2c3d" }, ctx);

    expect(result).toMatchObject({ found: true, booking: { short_reference: "#0a1b2c3d" } });
    const call = sqlCalls[0]!;
    expect(call.values).toEqual(["user_host_1", "0a1b2c3d"]);
    expect(call.text).toContain('m."userId" = $1');
    expect(call.text).toContain("property_access");
  });

  it("answers missing and out-of-scope identically", async () => {
    sqlResults.push([]);
    const result = await HOST_TOOLS.get_booking.execute({ booking_reference: "#0a1b2c3d" }, ctx);
    expect(result).toMatchObject({ found: false });
    expect(JSON.stringify(result)).not.toContain(BOOKING_ID);
  });

  it("asks for more characters when a short reference matches two bookings", async () => {
    sqlResults.push([bookingRow(), bookingRow({ booking_id: "0a1b2c3d-9999-4222-8333-444455556666" })]);
    const result = await HOST_TOOLS.get_payment_status.execute({ booking_reference: "0a1b2c3d" }, ctx);
    expect(result).toMatchObject({ found: false, note: expect.stringContaining("More than one") });
  });

  it("fails closed without a verified host and never queries", async () => {
    const result = await HOST_TOOLS.get_booking.execute({}, { hostUserId: null });
    expect(result).toMatchObject({ found: false });
    expect(sqlCalls).toHaveLength(0);
  });

  it("offers no guest tools", () => {
    const names = HOST_AGENT.toolSchemas().map((t) => t.function.name);
    expect(names).toEqual(["get_booking", "get_payment_status", "escalate_to_human"]);
  });
});

describe("host pipeline", () => {
  function chat(responses: ChatResponse[]) {
    const seen: unknown[] = [];
    const fn: ChatFn = async (messages) => {
      seen.push(messages);
      const next = responses.shift();
      if (!next) throw new Error("exhausted");
      return next;
    };
    return Object.assign(fn, { seen });
  }

  const payload = {
    eventId: "message_created:7",
    conversationId: 88,
    messageId: 7,
    content: "Where is the payout for #0a1b2c3d?",
    // A host payload that somehow carries an email must still never reach guest tools.
    guestEmail: "host@hotel.test",
    audience: "host" as const,
    hostUserId: "user_host_1",
    ticket: { category: "payments", linkedType: "booking", linkedId: BOOKING_ID },
  };

  it("uses the host prompt, the ticket note and host tools, with typing around it", async () => {
    sqlResults.push([bookingRow()]);
    const fn = chat([
      { content: null, toolCalls: [{ id: "c1", function: { name: "get_booking", arguments: { booking_reference: "0a1b2c3d" } } }] },
      { content: "Booking #0a1b2c3d is confirmed." },
    ]);

    await processConversation(payload, { chat: fn });

    const first = fn.seen[0] as Array<{ role: string; content: string }>;
    expect(first[0]!.content).toContain("talking to a host");
    expect(first[1]!.content).toContain("Ticket category chosen by the host: payments");
    expect(sqlCalls[0]!.values[0]).toBe("user_host_1");
    expect(chatwootCalls).toEqual([{ kind: "reply", conversationId: 88, content: "Booking #0a1b2c3d is confirmed." }]);
    expect(typingCalls).toEqual([
      { conversationId: 88, on: true },
      { conversationId: 88, on: false },
    ]);
  });

  it("guest tool names don't resolve for a host", async () => {
    const fn = chat([
      { content: null, toolCalls: [{ id: "c1", function: { name: "get_reservation", arguments: {} } }] },
      { content: "ok" },
    ]);
    await processConversation({ ...payload, eventId: "message_created:8" }, { chat: fn });

    const second = fn.seen[1] as Array<{ role: string; content: string }>;
    expect(second.at(-1)!.content).toContain("Unknown tool: get_reservation");
  });

  it("dispute language hands off through the shared hand-off", async () => {
    await processConversation(
      { ...payload, eventId: "message_created:9", content: "The guest opened a chargeback" },
      { chat: chat([]) },
    );
    expect(chatwootCalls.map((c) => c.kind)).toEqual(["note", "status"]);
  });
});

describe("hostTicketNote", () => {
  it("is empty without facts, and states only what the system recorded", () => {
    expect(hostTicketNote({ category: null, linkedType: null, linkedId: null })).toBeUndefined();
    expect(hostTicketNote({ category: "listing", linkedType: "listing", linkedId: "p-1" })).toContain("property p-1");
  });
});

describe("reply email", () => {
  it("carries the reference and link, never the message or title", () => {
    const email = renderSupportReplyEmail({ name: "Sam Host", reference: 12, url: "https://b.test/support?ticket=t-1" });
    expect(email.subject).toBe("New reply on your support ticket #12");
    expect(email.text).toContain("Hi Sam,");
    expect(email.html).toContain('href="https://b.test/support?ticket=t-1"');
  });

  it("escapes the name", () => {
    const email = renderSupportReplyEmail({ name: "<script>", reference: 1, url: "https://b.test" });
    expect(email.html).not.toContain("<script>");
  });
});

describe("requiredAtStartup", () => {
  const keys = ["TASKS_INLINE", "SUPPORT_CHAT_ENABLED"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const restore = () => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };

  it("always asks for the Agent Bot credentials", () => {
    expect(requiredAtStartup()).toEqual(
      expect.arrayContaining(["CHATWOOT_BOT_ACCESS_TOKEN", "CHATWOOT_BOT_WEBHOOK_SECRET"]),
    );
  });

  it("asks for queue credentials and support settings only when used", () => {
    try {
      delete process.env.TASKS_INLINE;
      delete process.env.SUPPORT_CHAT_ENABLED;
      const queued = requiredAtStartup();
      expect(queued).toContain("QSTASH_TOKEN");
      expect(queued).not.toContain("CHATWOOT_ACCOUNT_WEBHOOK_SECRET");

      process.env.SUPPORT_CHAT_ENABLED = "true";
      const support = requiredAtStartup();
      expect(support).toContain("CHATWOOT_ACCOUNT_WEBHOOK_SECRET");
      expect(support).toContain("LETTERMINT_PROJECT_TOKEN");

      process.env.TASKS_INLINE = "true";
      expect(requiredAtStartup()).not.toContain("QSTASH_TOKEN");
    } finally {
      restore();
    }
  });
});
