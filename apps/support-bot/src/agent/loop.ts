import { Mistral } from "@mistralai/mistralai";
import type { CachedTurn } from "@openbookings/db";
import { env } from "../env";
import { SYSTEM_PROMPT } from "./prompt";
import { executeTool, mistralToolSchemas, TOOLS } from "./tools";

export const MISTRAL_MODEL = "mistral-medium-latest";
export const MAX_TOOL_ITERATIONS = 5;

/** Structural message type shared by the loop and the injectable chat fn. */
export type LoopMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LoopToolCall[] }
  | { role: "tool"; name: string; content: string; toolCallId: string };

export type LoopToolCall = {
  id: string;
  function: { name: string; arguments: string | Record<string, unknown> };
};

export type ChatResponse = { content: string | null; toolCalls?: LoopToolCall[] };

/** One Mistral chat completion. Injectable so the loop is unit-testable. */
export type ChatFn = (messages: LoopMessage[]) => Promise<ChatResponse>;

export type ToolCallLogEntry = { name: string; args: unknown; result: unknown };

export type AgentOutcome =
  | { kind: "reply"; text: string; toolLog: ToolCallLogEntry[] }
  | { kind: "escalate"; reason: string; toolLog: ToolCallLogEntry[] };

function parseArgs(raw: string | Record<string, unknown>): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * The function-calling loop: conversation + tool schemas → execute returned
 * tool calls → feed results back → repeat until final text, escalation, or
 * the iteration cap (which itself escalates — never fail silent).
 *
 * `onToolResult` is the rule-driven escalation hook: called with every
 * successful tool result; returning a string forces escalation with that
 * reason.
 */
export async function runAgentLoop(opts: {
  turns: CachedTurn[];
  chat: ChatFn;
  onToolResult?: (toolName: string, result: unknown) => string | null;
  maxIterations?: number;
}): Promise<AgentOutcome> {
  const maxIterations = opts.maxIterations ?? MAX_TOOL_ITERATIONS;
  const messages: LoopMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...opts.turns.map((t): LoopMessage => ({ role: t.role, content: t.content })),
  ];
  const toolLog: ToolCallLogEntry[] = [];

  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    const response = await opts.chat(messages);
    const toolCalls = response.toolCalls ?? [];

    if (toolCalls.length === 0) {
      const text = response.content?.trim();
      if (text) return { kind: "reply", text, toolLog };
      return { kind: "escalate", reason: "Model returned an empty response.", toolLog };
    }

    if (iteration === maxIterations) {
      return { kind: "escalate", reason: "Unable to resolve after max tool calls.", toolLog };
    }

    messages.push({ role: "assistant", content: response.content ?? "", toolCalls });

    for (const call of toolCalls) {
      const name = call.function.name;
      const args = parseArgs(call.function.arguments);

      if (name === "escalate_to_human") {
        const parsed = TOOLS.escalate_to_human.schema.safeParse(args);
        const reason = parsed.success ? parsed.data.reason : "Model requested escalation.";
        return { kind: "escalate", reason, toolLog };
      }

      const execution = await executeTool(name, args);
      const result = execution.ok ? execution.result : { error: execution.error };
      toolLog.push({ name, args, result });

      if (execution.ok && opts.onToolResult) {
        const forcedReason = opts.onToolResult(name, execution.result);
        if (forcedReason) return { kind: "escalate", reason: forcedReason, toolLog };
      }

      messages.push({
        role: "tool",
        name,
        content: JSON.stringify(result),
        toolCallId: call.id,
      });
    }
  }

  // Unreachable: the cap check above returns first. Kept for type totality.
  return { kind: "escalate", reason: "Unable to resolve after max tool calls.", toolLog };
}

/** Production ChatFn backed by the Mistral SDK. */
export function mistralChat(): ChatFn {
  const client = new Mistral({ apiKey: env.mistralApiKey });
  const tools = mistralToolSchemas();
  return async (messages) => {
    const response = await client.chat.complete({
      model: MISTRAL_MODEL,
      messages: messages as never,
      tools: tools as never,
      toolChoice: "auto",
    });
    const message = response.choices?.[0]?.message;
    const content =
      typeof message?.content === "string"
        ? message.content
        : (message?.content ?? [])
            .map((chunk) => (chunk.type === "text" ? chunk.text : ""))
            .join("");
    const toolCalls = (message?.toolCalls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments as string | Record<string, unknown>,
      },
    }));
    return { content, toolCalls };
  };
}
