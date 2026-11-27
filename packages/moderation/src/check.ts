import { Mistral } from "@mistralai/mistralai";
import { screenReviewFragments } from "@openbookings/messaging/screen-review";
import { REVIEW_RULE_IDS, isReviewRuleId, type ReviewRuleId, type TextCheck } from "@openbookings/pricing";
import { SYSTEM_PROMPT, VIOLATIONS_SCHEMA } from "./prompt";

/** Mistral gets this long to answer; after that the text is held as unchecked. */
export const MISTRAL_TIMEOUT_MS = 3000;

/**
 * One model call: the rules as the system message, the text alone as the user
 * message. Returns the raw JSON the model wrote. Injectable for tests.
 */
export type ChatFn = (req: { system: string; user: string; schema: object; signal: AbortSignal }) => Promise<string>;

/** The production ChatFn: Mistral's chat API with a strict JSON schema answer. */
export function mistralChat(): ChatFn {
  const apiKey = process.env.MISTRAL_API_KEY;
  const model = process.env.MISTRAL_MODEL?.trim();
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not set");
  if (!model) throw new Error("MISTRAL_MODEL is not set");
  const client = new Mistral({ apiKey });
  return async ({ system, user, schema, signal }) => {
    const response = await client.chat.complete(
      {
        model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        responseFormat: {
          type: "json_schema",
          jsonSchema: { name: "review_violations", schemaDefinition: schema as Record<string, unknown>, strict: true },
        },
      },
      // Our own timeout decides; a retry would only run past it.
      { signal, retries: { strategy: "none" } },
    );
    const content = response.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    return (content ?? []).map((chunk) => (chunk.type === "text" ? chunk.text : "")).join("");
  };
}

/**
 * Reads the model's answer. Unknown rules are dropped. A fragment counts only
 * when it is an exact (case-sensitive) substring of the text, but its rule
 * holds either way. Throws when the answer isn't the expected shape.
 */
function readViolations(raw: string, text: string): { rules: ReviewRuleId[]; fragments: string[] } {
  const parsed: unknown = JSON.parse(raw);
  const violations = (parsed as { violations?: unknown } | null)?.violations;
  if (!Array.isArray(violations)) throw new Error("answer has no violations list");
  const rules: ReviewRuleId[] = [];
  const fragments: string[] = [];
  for (const v of violations) {
    const { rule, fragment } = (v ?? {}) as { rule?: unknown; fragment?: unknown };
    if (!isReviewRuleId(rule)) continue;
    rules.push(rule);
    if (typeof fragment === "string" && fragment.length > 0 && text.includes(fragment)) fragments.push(fragment);
  }
  return { rules, fragments };
}

/** Runs the chat, rejecting (and aborting the request) after timeoutMs. */
async function withTimeout(chat: ChatFn, text: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Mistral timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      chat({ system: SYSTEM_PROMPT, user: text, schema: VIOLATIONS_SCHEMA, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks one review or reply. The regex screen runs first and always counts;
 * then Mistral reads the text alone (nothing else about the review is sent).
 * If Mistral fails, times out or answers something unreadable, the text is
 * `unchecked` with the regex findings, so a person looks at it.
 *
 * Nothing here logs: the text and the API key must never reach a log.
 */
export async function checkText(
  text: string | null,
  deps: { chat?: ChatFn; timeoutMs?: number } = {},
): Promise<TextCheck> {
  if (!text || text.trim() === "") return { verdict: "clean", rules: [], fragments: [], source: "regex" };

  const regex = screenReviewFragments(text);
  let model: { rules: ReviewRuleId[]; fragments: string[] };
  try {
    const chat = deps.chat ?? mistralChat();
    model = readViolations(await withTimeout(chat, text, deps.timeoutMs ?? MISTRAL_TIMEOUT_MS), text);
  } catch {
    return { verdict: "unchecked", rules: regex.rules, fragments: regex.fragments, source: "regex" };
  }

  const found = new Set<ReviewRuleId>([...regex.rules, ...model.rules]);
  const rules = REVIEW_RULE_IDS.filter((id) => found.has(id));
  const fragments = [...new Set([...regex.fragments, ...model.fragments])];
  return { verdict: rules.length > 0 ? "flagged" : "clean", rules, fragments, source: "mistral" };
}
