import { Mistral } from "@mistralai/mistralai";
import type { CachedTurn } from "@openbookings/db";
import { env } from "../env";
import { SYSTEM_PROMPT } from "./prompt";
import {
  escalateArgs,
  executeTool,
  mistralToolSchemas,
  type ToolContext,
  type ToolExecutionResult,
} from "./tools";
import { trace } from "../trace";

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

/**
 * Who the agent is talking to: its system prompt and its tools. The guest
 * profile is the default; host tickets use the one in src/host/. Profiles
 * never share tools, so a host conversation can't reach guest lookups and
 * the reverse.
 */
export type AgentProfile<Ctx> = {
  name: string;
  systemPrompt: string;
  toolSchemas: () => ReturnType<typeof mistralToolSchemas>;
  executeTool: (name: string, args: unknown, ctx: Ctx) => Promise<ToolExecutionResult>;
};

export const GUEST_AGENT: AgentProfile<ToolContext> = {
  name: "guest",
  systemPrompt: SYSTEM_PROMPT,
  toolSchemas: mistralToolSchemas,
  executeTool,
};

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
 *
 * `toolContext` carries the server-derived guest identity every tool scopes
 * its lookups to. It is threaded through the loop rather than read from the
 * turns, because the turns are guest-authored text.
 */
export async function runAgentLoop<Ctx = ToolContext>(opts: {
  turns: CachedTurn[];
  chat: ChatFn;
  toolContext: Ctx;
  /** Defaults to the guest profile. */
  profile?: AgentProfile<Ctx>;
  /**
   * Facts from the support system (never from the chat), given to the model
   * as a second system message — e.g. the ticket's category.
   */
  contextNote?: string;
  onToolResult?: (toolName: string, result: unknown) => string | null;
  maxIterations?: number;
}): Promise<AgentOutcome> {
  const maxIterations = opts.maxIterations ?? MAX_TOOL_ITERATIONS;
  const profile = opts.profile ?? (GUEST_AGENT as unknown as AgentProfile<Ctx>);
  const messages: LoopMessage[] = [
    { role: "system", content: profile.systemPrompt },
    ...(opts.contextNote ? [{ role: "system" as const, content: opts.contextNote }] : []),
    ...opts.turns.map((t): LoopMessage => ({ role: t.role, content: t.content })),
  ];
  const toolLog: ToolCallLogEntry[] = [];

  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    trace("loop", `iteration ${iteration}: calling model`);
    const response = await opts.chat(messages);
    const toolCalls = response.toolCalls ?? [];

    if (toolCalls.length === 0) {
      const text = response.content?.trim();
      if (text) {
        trace("loop", "final reply", { length: text.length });
        return { kind: "reply", text, toolLog };
      }
      trace("loop", "empty response from model → escalate");
      return { kind: "escalate", reason: "Model returned an empty response.", toolLog };
    }

    if (iteration === maxIterations) {
      trace("loop", "max iterations reached → escalate");
      return { kind: "escalate", reason: "Unable to resolve after max tool calls.", toolLog };
    }

    messages.push({ role: "assistant", content: response.content ?? "", toolCalls });

    for (const call of toolCalls) {
      const name = call.function.name;
      const args = parseArgs(call.function.arguments);
      trace("loop", `tool call: ${name}`, { args });

      if (name === "escalate_to_human") {
        const parsed = escalateArgs.safeParse(args);
        const reason = parsed.success ? parsed.data.reason : "Model requested escalation.";
        trace("loop", "escalate_to_human called by model", { reason });
        return { kind: "escalate", reason, toolLog };
      }

      const execution = await profile.executeTool(name, args, opts.toolContext);
      const result = execution.ok ? execution.result : { error: execution.error };
      toolLog.push({ name, args, result });
      trace("loop", `tool result: ${name}`, execution.ok ? { ok: true, result } : { ok: false, error: execution.error });

      if (execution.ok && opts.onToolResult) {
        const forcedReason = opts.onToolResult(name, execution.result);
        if (forcedReason) {
          trace("loop", "rule-driven escalation forced", { name, reason: forcedReason });
          return { kind: "escalate", reason: forcedReason, toolLog };
        }
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
export function mistralChat<Ctx>(profile: AgentProfile<Ctx> = GUEST_AGENT as unknown as AgentProfile<Ctx>): ChatFn {
  const client = new Mistral({ apiKey: env.mistralApiKey });
  const model = env.mistralModel;
  const tools = profile.toolSchemas();
  return async (messages) => {
    const response = await client.chat.complete({
      model,
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
