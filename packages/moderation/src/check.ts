import { Mistral } from "@mistralai/mistralai";
import { screenReviewFragments } from "@openbookings/messaging/screen-review";
import { REVIEW_RULE_IDS, type ReviewRuleId, type TextCheck } from "@openbookings/pricing";
import { isModelRuleId, SYSTEM_PROMPT, VIOLATIONS_SCHEMA } from "./prompt";

/** Mistral gets this long to answer; after that the text is held as unchecked. */
export const MISTRAL_TIMEOUT_MS = 3000;

/**
 * One model call: the rules as the system message, the text alone as the user
 * message. Returns the raw JSON the model wrote. Injectable for tests.
 */
export type ChatFn = (req: { system: string; user: string; schema: object; signal: AbortSignal }) => Promise<string>;

let cachedClient: { apiKey: string; client: Mistral } | undefined;

/** One Mistral client per process, made on first use and remade only when the key changes. */
export function mistralClient(apiKey: string): Mistral {
  if (cachedClient?.apiKey !== apiKey) cachedClient = { apiKey, client: new Mistral({ apiKey }) };
  return cachedClient.client;
}

/** The production ChatFn: Mistral's chat API with a strict JSON schema answer. */
export function mistralChat(): ChatFn {
  const apiKey = process.env.MISTRAL_API_KEY;
  const model = process.env.MISTRAL_MODEL?.trim();
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not set");
  if (!model) throw new Error("MISTRAL_MODEL is not set");
  const client = mistralClient(apiKey);
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

/** Shorter model fragments (or whitespace) would mask stray letters all over the text. */
const MIN_FRAGMENT_LENGTH = 3;

/**
 * Reads the model's answer. Unknown rules, and rules it wasn't asked about
 * (MODEL_RULE_IDS), are dropped. A fragment counts only
 * when it is an exact (case-sensitive) substring of the text with at least
 * three characters besides surrounding whitespace, but its rule holds either
 * way. Throws when the answer isn't the expected shape.
 */
function readViolations(raw: string, text: string): { rules: ReviewRuleId[]; fragments: string[] } {
  const parsed: unknown = JSON.parse(raw);
  const violations = (parsed as { violations?: unknown } | null)?.violations;
  if (!Array.isArray(violations)) throw new Error("answer has no violations list");
  const rules: ReviewRuleId[] = [];
  const fragments: string[] = [];
  for (const v of violations) {
    const { rule, fragment } = (v ?? {}) as { rule?: unknown; fragment?: unknown };
    if (!isModelRuleId(rule)) continue;
    rules.push(rule);
    if (typeof fragment === "string" && fragment.trim().length >= MIN_FRAGMENT_LENGTH && text.includes(fragment)) {
      fragments.push(fragment);
    }
  }
  return { rules, fragments };
}

class MistralTimeout extends Error {}

/** Runs the chat, rejecting (and aborting the request) after timeoutMs. */
async function withTimeout(chat: ChatFn, text: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new MistralTimeout());
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
 * A failure logs one line with the error's name only: error messages can
 * quote the request, and the text and the API key must never reach a log.
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
  } catch (err) {
    const reason = err instanceof MistralTimeout ? "timeout" : err instanceof Error ? err.name : typeof err;
    console.warn("[moderation] check unavailable:", reason);
    return { verdict: "unchecked", rules: regex.rules, fragments: regex.fragments, source: "regex" };
  }

  const found = new Set<ReviewRuleId>([...regex.rules, ...model.rules]);
  const rules = REVIEW_RULE_IDS.filter((id) => found.has(id));
  const fragments = [...new Set([...regex.fragments, ...model.fragments])];
  return { verdict: rules.length > 0 ? "flagged" : "clean", rules, fragments, source: "mistral" };
}
