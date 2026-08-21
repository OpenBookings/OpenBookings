import { describe, expect, it } from "bun:test";
import {
  MAX_TOOL_ITERATIONS,
  runAgentLoop,
  type ChatFn,
  type ChatResponse,
  type LoopMessage,
} from "./loop";
import type { ToolContext } from "./tools";

// Non-UUID booking references make the reservation tools return "not found"
// without touching the database, so the loop is exercised end-to-end offline.

/** An identified guest — these tests are about loop control flow, not authorization. */
const GUEST: ToolContext = { guestEmail: "guest@example.com" };

function scriptedChat(responses: ChatResponse[]): { chat: ChatFn; calls: LoopMessage[][] } {
  const calls: LoopMessage[][] = [];
  const remaining = [...responses];
  return {
    calls,
    chat: async (messages) => {
      calls.push(messages.map((m) => ({ ...m })));
      const next = remaining.shift();
      if (!next) throw new Error("scripted chat exhausted");
      return next;
    },
  };
}

function toolCall(name: string, args: unknown, id = "call_1") {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

describe("runAgentLoop", () => {
  it("resolves a query needing two chained tool calls in one turn", async () => {
    const { chat, calls } = scriptedChat([
      { content: null, toolCalls: [toolCall("get_reservation", { booking_reference: "REF-1" })] },
      { content: null, toolCalls: [toolCall("get_cancellation_policy", { booking_reference: "REF-1" }, "call_2")] },
      { content: "Your booking is refundable until 5 days before check-in." },
    ]);

    const outcome = await runAgentLoop({
      turns: [{ role: "user", content: "Is my booking refundable?" }],
      chat,
      toolContext: GUEST,
    });

    expect(outcome.kind).toBe("reply");
    if (outcome.kind === "reply") {
      expect(outcome.text).toContain("refundable");
      expect(outcome.toolLog.map((t) => t.name)).toEqual([
        "get_reservation",
        "get_cancellation_policy",
      ]);
    }
    // Each tool result was fed back to the model before the next call.
    const lastMessages = calls[2]!;
    expect(lastMessages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("treats escalate_to_human as terminal and surfaces the reason", async () => {
    const { chat } = scriptedChat([
      {
        content: null,
        toolCalls: [
          toolCall("get_reservation", { booking_reference: "REF-1" }),
          toolCall("escalate_to_human", { reason: "Guest wants a person" }, "call_2"),
        ],
      },
    ]);

    const outcome = await runAgentLoop({
      turns: [{ role: "user", content: "Let me talk to a human" }],
      chat,
      toolContext: GUEST,
    });

    expect(outcome).toMatchObject({ kind: "escalate", reason: "Guest wants a person" });
  });

  it("auto-escalates after the max tool-call iterations", async () => {
    const endless: ChatResponse = {
      content: null,
      toolCalls: [toolCall("get_reservation", { booking_reference: "REF-1" })],
    };
    const { chat, calls } = scriptedChat(Array(10).fill(endless));

    const outcome = await runAgentLoop({
      turns: [{ role: "user", content: "help" }],
      chat,
      toolContext: GUEST,
      maxIterations: 3,
    });

    expect(outcome).toMatchObject({
      kind: "escalate",
      reason: "Unable to resolve after max tool calls.",
    });
    expect(calls).toHaveLength(4); // 3 tool iterations + the capped attempt
  });

  it("terminates at the production cap on a pathological tool-call chain", async () => {
    // A model that never stops calling tools. The scripted chat is primed
    // with far more responses than the cap allows, so if the loop failed to
    // terminate this would keep running rather than fail fast.
    const endless: ChatResponse = {
      content: null,
      toolCalls: [toolCall("get_reservation", { booking_reference: "REF-1" })],
    };
    const { chat, calls } = scriptedChat(Array(100).fill(endless));

    const outcome = await runAgentLoop({
      turns: [{ role: "user", content: "help" }],
      chat, // no maxIterations override — the real default
      toolContext: GUEST,
    });

    expect(outcome).toMatchObject({
      kind: "escalate",
      reason: "Unable to resolve after max tool calls.",
    });
    // MAX_TOOL_ITERATIONS tool rounds, then one final capped attempt.
    expect(calls).toHaveLength(MAX_TOOL_ITERATIONS + 1);
    if (outcome.kind === "escalate") {
      expect(outcome.toolLog).toHaveLength(MAX_TOOL_ITERATIONS);
    }
  });

  it("lets onToolResult force escalation off a tool result", async () => {
    const { chat } = scriptedChat([
      { content: null, toolCalls: [toolCall("get_reservation", { booking_reference: "REF-1" })] },
    ]);

    const outcome = await runAgentLoop({
      turns: [{ role: "user", content: "where is my refund" }],
      chat,
      toolContext: GUEST,
      onToolResult: () => "Forced by rule-based check",
    });

    expect(outcome).toMatchObject({ kind: "escalate", reason: "Forced by rule-based check" });
  });

  it("feeds invalid tool arguments back as errors instead of crashing", async () => {
    // get_payment_status requires a booking reference; an empty object is the
    // schema violation here. (An empty get_reservation is *valid* — it means
    // "this guest's bookings".)
    const { chat, calls } = scriptedChat([
      { content: null, toolCalls: [toolCall("get_payment_status", {})] },
      { content: "Could you share your booking reference?" },
    ]);

    const outcome = await runAgentLoop({
      turns: [{ role: "user", content: "check my booking" }],
      chat,
      toolContext: GUEST,
    });

    expect(outcome.kind).toBe("reply");
    const toolMessage = calls[1]!.find((m) => m.role === "tool");
    expect(toolMessage && "content" in toolMessage ? toolMessage.content : "").toContain("Invalid arguments");
  });
});
