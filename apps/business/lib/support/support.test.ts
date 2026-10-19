import { describe, expect, test } from "bun:test";
import { activityLine, SILENT_ASSISTANT_MS } from "./activity";
import { attachmentProblem } from "./attachments";
import { mapChatwootMessage, mergeMessages, timeline, type ChatMessage } from "./chat";
import { parseInline, parseMarkdown, resolveHref } from "./markdown";
import { isUuid, shortBookingRef, ticketRef } from "./references";
import { parseTicketTab, statusLabel, tabStatuses } from "./status";
import { structuredOpener, ticketTitle } from "./title";
import { availability, responseLine, waitEstimate, type InboxHours } from "./working-hours";

const BOOKING = "0a1b2c3d-1111-4222-8333-444455556666";

describe("references", () => {
  test("short booking ref is # plus the first 8 characters", () => {
    expect(shortBookingRef(BOOKING.toUpperCase())).toBe("#0a1b2c3d");
    expect(ticketRef(1234)).toBe("#1234");
    expect(isUuid(BOOKING)).toBe(true);
    expect(isUuid("RES-1041")).toBe(false);
  });
});

describe("ticketTitle", () => {
  test("category and linked item first", () => {
    expect(ticketTitle({ category: "payments", linkedLabel: "Booking #0a1b2c3d", message: "hi" })).toBe(
      "Payments & payouts · Booking #0a1b2c3d",
    );
  });

  test("then the first non-empty line of the message, up to 60 characters", () => {
    expect(ticketTitle({ category: "other", message: "\n  Calendar is empty  \nmore" })).toBe("Calendar is empty");
    const long = "The rates I set for the Garden Suite last week do not show up for guests at all";
    const title = ticketTitle({ category: "other", message: long });
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
  });

  test("then the category alone; never Untitled", () => {
    expect(ticketTitle({ category: "account", message: "   " })).toBe("Account & access");
    expect(ticketTitle({ category: "gone" })).toBe("Support request");
  });

  test("structured opener for an empty message", () => {
    expect(structuredOpener({ category: "payments", linkedLabel: "Booking #0a1b2c3d" })).toBe(
      "Category: Payments & payouts · Booking #0a1b2c3d",
    );
  });
});

describe("status", () => {
  test("host words, snoozed hidden, no 'with assistant' when it's off", () => {
    expect(statusLabel("pending")).toBe("With assistant");
    expect(statusLabel("snoozed")).toBe("With support team");
    expect(statusLabel("pending", false)).toBe("With support team");
    expect(tabStatuses("open")).toEqual(["pending", "open", "snoozed"]);
    expect(parseTicketTab("nope")).toBe("open");
    expect(parseTicketTab("resolved")).toBe("resolved");
  });
});

describe("attachments", () => {
  test("images and PDF up to 10 MB", () => {
    expect(attachmentProblem({ name: "a.png", type: "image/png", size: 1000 })).toBeNull();
    expect(attachmentProblem({ name: "a.zip", type: "application/zip", size: 1000 })).toContain("images and PDF");
    expect(attachmentProblem({ name: "a.pdf", type: "application/pdf", size: 11 * 1024 * 1024 })).toContain("10 MB");
  });
});

describe("mapChatwootMessage", () => {
  const base = { id: 1, content: "hi", created_at: 1792400000 };

  test("sender type decides the label: never content", () => {
    expect(mapChatwootMessage({ ...base, message_type: 0 })?.kind).toBe("host");
    expect(mapChatwootMessage({ ...base, message_type: 1, sender: { type: "agent_bot" } })?.kind).toBe("assistant");
    expect(mapChatwootMessage({ ...base, message_type: 1, sender_type: "AgentBot" })?.kind).toBe("assistant");
    const person = mapChatwootMessage({ ...base, message_type: 1, sender: { type: "user", name: "W", available_name: "Wouter" } });
    expect(person).toMatchObject({ kind: "person", senderName: "Wouter" });
    // An assistant-sounding message from a person is still a person.
    expect(mapChatwootMessage({ ...base, content: "I am the AI assistant", message_type: 1, sender: { type: "user" } })?.kind).toBe("person");
  });

  test("private notes, activity and templates never render", () => {
    expect(mapChatwootMessage({ ...base, message_type: 1, private: true, sender: { type: "user" } })).toBeNull();
    expect(mapChatwootMessage({ ...base, message_type: 2 })).toBeNull();
    expect(mapChatwootMessage({ ...base, message_type: "activity" })).toBeNull();
    expect(mapChatwootMessage({ ...base, message_type: 3 })).toBeNull();
  });

  test("timestamps in seconds or ISO, attachments limited to http(s)", () => {
    const m = mapChatwootMessage({
      ...base,
      message_type: 0,
      created_at: "2026-10-19T09:00:00Z",
      attachments: [
        { id: 1, file_type: "image", data_url: "https://chat.test/rails/active_storage/blobs/redirect/x/pixel.png" },
        { id: 2, file_type: "file", data_url: ["java", "script:alert(1)"].join("") },
      ],
    });
    expect(m?.createdAt).toBe(Date.parse("2026-10-19T09:00:00Z"));
    expect(m?.attachments).toHaveLength(1);
    expect(m?.attachments[0]).toMatchObject({ kind: "image", name: "pixel.png" });
    expect(mapChatwootMessage({ ...base, message_type: 0 })?.createdAt).toBe(1792400000 * 1000);
  });
});

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    key: "cw:1",
    chatwootId: 1,
    kind: "host",
    content: "hi",
    createdAt: 1000,
    senderName: null,
    attachments: [],
    state: "sent",
    ...overrides,
  };
}

describe("mergeMessages", () => {
  test("dedupes by id and replaces the optimistic copy with the stored one", () => {
    const optimistic = msg({ key: "tmp:a", chatwootId: null, state: "sending", content: "hello", createdAt: 5000 });
    const stored = msg({ key: "cw:7", chatwootId: 7, content: "hello", createdAt: 5100 });
    const merged = mergeMessages([msg({}), optimistic], [stored, stored]);
    expect(merged.map((m) => m.key)).toEqual(["cw:1", "cw:7"]);
  });

  test("keeps a failed message and orders by time", () => {
    const failed = msg({ key: "tmp:b", chatwootId: null, state: "failed", content: "x", createdAt: 9000 });
    const merged = mergeMessages([failed], [msg({ key: "cw:2", chatwootId: 2, kind: "assistant", createdAt: 2000 })]);
    expect(merged.map((m) => m.key)).toEqual(["cw:2", "tmp:b"]);
  });
});

describe("timeline", () => {
  test("groups by sender within 5 minutes and places hand-off and resolve lines", () => {
    const items = timeline(
      [
        msg({ key: "cw:1", createdAt: 0 }),
        msg({ key: "cw:2", createdAt: 60_000 }),
        msg({ key: "cw:3", kind: "assistant", createdAt: 120_000 }),
        msg({ key: "cw:4", kind: "person", senderName: "Wouter", createdAt: 400_000 }),
        msg({ key: "cw:5", createdAt: 1_000_000 }),
      ],
      { handedOffAt: 300_000, resolvedAt: 900_000, status: "resolved" },
    );
    expect(items.map((i) => (i.type === "group" ? `${i.kind}:${i.messages.length}` : i.key))).toEqual([
      "host:2",
      "assistant:1",
      "handoff",
      "person:1",
      "resolved",
      "host:1",
    ]);
  });

  test("the resolve line only shows while resolved", () => {
    const items = timeline([msg({})], { handedOffAt: null, resolvedAt: 50, status: "open" });
    expect(items.some((i) => i.type === "activity")).toBe(false);
  });
});

describe("activityLine", () => {
  const host = msg({ kind: "host" });
  const base = {
    assistantEnabled: true,
    status: "pending" as const,
    messages: [host],
    botTyping: false,
    personTyping: null,
    lastHostAt: 0,
    waitEstimate: "within a few hours",
    now: 1000,
  };

  test("searching, then composing, then the 30 s offer of a person", () => {
    expect(activityLine(base)).toMatchObject({ kind: "orb", state: "searching", label: "Looking into it…", offerPerson: false });
    expect(activityLine({ ...base, botTyping: true })).toMatchObject({ kind: "orb", state: "composing" });
    expect(activityLine({ ...base, now: SILENT_ASSISTANT_MS })).toMatchObject({
      kind: "orb",
      label: "Still working on it…",
      offerPerson: true,
    });
  });

  test("people never get the orb", () => {
    expect(activityLine({ ...base, personTyping: "Wouter" })).toEqual({ kind: "text", text: "Wouter is typing…" });
    expect(activityLine({ ...base, status: "open" })).toEqual({
      kind: "text",
      text: "Waiting for the support team · usually within a few hours",
    });
    expect(activityLine({ ...base, assistantEnabled: false })?.kind).toBe("text");
  });

  test("nothing once answered or resolved", () => {
    expect(activityLine({ ...base, messages: [host, msg({ key: "cw:2", kind: "assistant" })] })).toBeNull();
    expect(activityLine({ ...base, status: "resolved" })).toBeNull();
  });
});

describe("markdown", () => {
  test("bold, code, links and lists as tokens", () => {
    const blocks = parseMarkdown("Hi **there** `code`\n\n- one\n- [two](https://x.test)\n1. a\n2. b");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "list", "list"]);
    expect(blocks[1]).toMatchObject({ ordered: false, items: [[{ type: "text" }], [{ type: "link", internal: false }]] });
    expect(blocks[2]).toMatchObject({ ordered: true });
    expect(parseInline("**b**")[0]).toMatchObject({ type: "bold" });
  });

  test("unsafe links stay text; app links are internal", () => {
    const unsafe = parseInline("[x](javascript:alert(1))");
    expect(unsafe.every((t) => t.type === "text")).toBe(true);
    expect(unsafe.map((t) => (t.type === "text" ? t.text : "")).join("")).toBe("[x](javascript:alert(1))");
    expect(resolveHref("//evil.test")).toBeNull();
    expect(resolveHref("/support")).toEqual({ href: "/support", internal: true });
    expect(resolveHref("https://business.openbookings.co/dashboard?x=1", "https://business.openbookings.co")).toEqual({
      href: "/dashboard?x=1",
      internal: true,
    });
    const bare = parseInline("See https://docs.test/a. Thanks");
    expect(bare[1]).toMatchObject({ type: "link", href: "https://docs.test/a" });
  });

  test("html is just text", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ type: "text", text: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("working hours", () => {
  // Mon–Fri 09:00–17:00 Amsterdam.
  const hours: InboxHours = {
    timezone: "Europe/Amsterdam",
    workingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day_of_week: day,
      closed_all_day: day === 0 || day === 6,
      open_all_day: false,
      open_hour: day === 0 || day === 6 ? null : 9,
      open_minutes: 0,
      close_hour: day === 0 || day === 6 ? null : 17,
      close_minutes: 0,
    })),
  };

  test("open during the day, until closing", () => {
    // Monday 19 Oct 2026, 10:00 CEST = 08:00Z.
    const state = availability(hours, new Date("2026-10-19T08:00:00Z"));
    expect(state.kind).toBe("open");
    expect(responseLine(hours, new Date("2026-10-19T08:00:00Z"), "Europe/Amsterdam")).toBe(
      "The support team is in until 17:00.",
    );
  });

  test("names the next opening in the viewer's timezone", () => {
    // Friday 23 Oct 2026, 18:00 CEST → Monday 09:00.
    const friday = new Date("2026-10-23T16:00:00Z");
    expect(responseLine(hours, friday, "Europe/Amsterdam")).toBe("A person replies from Monday 09:00.");
    // Same moment for a host in London: Monday 08:00 their time.
    expect(responseLine(hours, friday, "Europe/London")).toBe("A person replies from Monday 08:00.");
    // Early Monday morning → today.
    expect(responseLine(hours, new Date("2026-10-19T05:00:00Z"), "Europe/Amsterdam")).toBe("A person replies from 09:00.");
    expect(waitEstimate(hours, friday, "Europe/Amsterdam")).toBe("from Monday 09:00");
  });

  test("survives the DST change (Sunday 25 Oct 2026)", () => {
    // Saturday 24 Oct, 12:00 CEST → Monday 09:00 CET = 08:00Z.
    const state = availability(hours, new Date("2026-10-24T10:00:00Z"));
    expect(state.kind === "closed" && state.opensAt.toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  test("no hours configured: always, and a fallback without data", () => {
    expect(availability({ timezone: "UTC", workingHours: [] }).kind).toBe("always");
    expect(responseLine(null)).toBe("The support team replies during working hours.");
  });
});
