/**
 * Mistral connectivity + tool-schema check.
 *
 *   bun run scripts/check-mistral.ts
 *
 * Three things fail independently, so they are checked separately:
 *   1. the API key authenticates and the pinned model exists;
 *   2. the tool declarations we generate from Zod are actually accepted
 *      (z.toJSONSchema output is only validated by Mistral's API, never by
 *      our own tests);
 *   3. the model reaches for a tool when the guest gives a booking reference.
 *
 * Nothing here touches the database, Stripe, or Chatwoot.
 */
import { MISTRAL_MODEL, mistralChat } from "../src/agent/loop";
import { SYSTEM_PROMPT } from "../src/agent/prompt";
import { mistralToolSchemas } from "../src/agent/tools";

function ok(label: string, detail = "") {
  console.log(`  \x1b[32mPASS\x1b[0m  ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail: string) {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${label} — ${detail}`);
}

console.log(`\nMistral check (model: ${MISTRAL_MODEL})\n`);

const toolNames = mistralToolSchemas().map((t) => t.function.name);
console.log(`  tools declared: ${toolNames.join(", ")}\n`);

const chat = mistralChat();
let failures = 0;

// 1 + 2: auth, model, and tool declarations all exercised in one call.
try {
  const res = await chat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "Hi! What time is check-in usually?" },
  ]);
  const text = res.content?.trim() ?? "";
  if (text || (res.toolCalls?.length ?? 0) > 0) {
    ok("auth + model reachable");
    ok("tool schemas accepted by the API");
    if (text) console.log(`\n  reply: ${text.slice(0, 300)}\n`);
  } else {
    failures++;
    fail("round-trip", "empty response with no tool calls");
  }
} catch (err) {
  failures++;
  const message = err instanceof Error ? err.message : String(err);
  fail("auth / model / tool schemas", message.slice(0, 400));
  if (/401|unauthor/i.test(message)) console.log("\n  → check MISTRAL_API_KEY\n");
  if (/model/i.test(message)) console.log(`\n  → is "${MISTRAL_MODEL}" enabled on this account?\n`);
}

// 3: does it actually call a tool when it should?
if (failures === 0) {
  try {
    const res = await chat([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Can you check my booking? The reference is 3f7c1a92-5b2e-4d81-9f30-6a1c4e88b7d2.",
      },
    ]);
    const called = res.toolCalls?.map((t) => t.function.name) ?? [];
    if (called.length > 0) {
      ok("model issues tool calls", called.join(", "));
    } else {
      // Not fatal: prompt/model behaviour, not a broken connection.
      console.log(
        `  \x1b[33mWARN\x1b[0m  model answered without calling a tool — reply: ${res.content?.slice(0, 160)}`,
      );
    }
  } catch (err) {
    failures++;
    fail("tool-calling round-trip", err instanceof Error ? err.message.slice(0, 300) : String(err));
  }
}

console.log(failures === 0 ? "\nMistral OK\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
