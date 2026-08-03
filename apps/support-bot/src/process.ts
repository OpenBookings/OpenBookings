import {
  getConversationCache,
  hasRepliedToEvent,
  markEventReplied,
  setConversationCache,
  type CachedTurn,
} from "@openbookings/db";
import type { PaymentSummary } from "@openbookings/stripe";
import {
  getConversationMessages,
  postPrivateNote,
  postReply,
  setConversationStatus,
} from "./chatwoot/client";
import { env } from "./env";
import { messageTriggersEscalation, paymentTriggersEscalation } from "./escalation";
import { mistralChat, runAgentLoop, type ChatFn, type ToolCallLogEntry } from "./agent/loop";
import type { ProcessConversationPayload } from "./tasks";

/** Cached context is considered fresh for this long; older → refetch from Chatwoot. */
const CONTEXT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** How many prior turns to feed the model. */
const MAX_CONTEXT_TURNS = 20;

function escalationNote(reason: string, toolLog: ToolCallLogEntry[]): string {
  const lines = [
    "**Support bot escalation**",
    "",
    `**Reason:** ${reason}`,
  ];
  if (toolLog.length > 0) {
    lines.push("", "**What the bot already looked up:**");
    for (const entry of toolLog) {
      lines.push(
        `- \`${entry.name}\` ${JSON.stringify(entry.args)} → ${JSON.stringify(entry.result).slice(0, 500)}`,
      );
    }
  } else {
    lines.push("", "No lookups were performed before escalating.");
  }
  return lines.join("\n");
}

/** Map Chatwoot history to model turns: public incoming ↔ user, public outgoing ↔ assistant. */
async function fetchTurnsFromChatwoot(conversationId: number): Promise<CachedTurn[]> {
  const messages = await getConversationMessages(conversationId);
  return messages
    .filter((m) => !m.private && m.content && (m.message_type === 0 || m.message_type === 1))
    .map((m): CachedTurn => ({
      role: m.message_type === 0 ? "user" : "assistant",
      content: m.content!,
    }));
}

/**
 * The async side of the pipeline, invoked by Cloud Tasks. Safe to retry: the
 * replied_at guard makes re-runs of an already-replied event no-ops, so
 * retries never post a duplicate guest-facing reply.
 */
export async function processConversation(
  payload: ProcessConversationPayload,
  deps: { chat?: ChatFn } = {},
): Promise<void> {
  const { eventId, conversationId, content } = payload;

  if (await hasRepliedToEvent(eventId)) return;

  const escalate = async (reason: string, toolLog: ToolCallLogEntry[]) => {
    await postPrivateNote(conversationId, escalationNote(reason, toolLog));
    await setConversationStatus(conversationId, "open");
    await markEventReplied(eventId);
  };

  // Rule-driven safety net #1: dispute/chargeback language in the incoming
  // message escalates before the model is ever called.
  const preCheckReason = messageTriggersEscalation(content);
  if (preCheckReason) {
    await escalate(preCheckReason, []);
    return;
  }

  let turns =
    (await getConversationCache(conversationId, CONTEXT_CACHE_TTL_MS)) ??
    (await fetchTurnsFromChatwoot(conversationId));
  // The triggering message postdates the cache (and may race the history
  // fetch) — make sure it's the final user turn exactly once.
  if (turns.at(-1)?.role !== "user" || turns.at(-1)?.content !== content) {
    turns = [...turns, { role: "user", content }];
  }
  turns = turns.slice(-MAX_CONTEXT_TURNS);

  const outcome = await runAgentLoop({
    turns,
    chat: deps.chat ?? mistralChat(),
    // Rule-driven safety net #2: payment lookups revealing a dispute or
    // large refund force escalation regardless of what the model would do.
    onToolResult: (toolName, result) => {
      if (toolName !== "get_payment_status") return null;
      const summary = result as Partial<PaymentSummary>;
      if (typeof summary?.status !== "string" || typeof summary.amount !== "number") return null;
      return paymentTriggersEscalation(summary as PaymentSummary, env.refundEscalationThresholdEur);
    },
  });

  if (outcome.kind === "escalate") {
    await escalate(outcome.reason, outcome.toolLog);
    await setConversationCache(conversationId, turns);
    return;
  }

  await postReply(conversationId, outcome.text);
  await markEventReplied(eventId);
  await setConversationCache(conversationId, [
    ...turns,
    { role: "assistant", content: outcome.text },
  ]);
}
