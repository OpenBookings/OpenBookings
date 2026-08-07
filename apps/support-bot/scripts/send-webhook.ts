/**
 * Send a correctly-signed Chatwoot `message_created` webhook to the local bot.
 *
 *   bun run scripts/send-webhook.ts "Is my booking refundable?"
 *   bun run scripts/send-webhook.ts --conversation 42 "hallo"
 *   bun run scripts/send-webhook.ts --replay "..."   # reuse the last message id
 *
 * Signs with CHATWOOT_WEBHOOK_SECRET exactly as Chatwoot does, so this
 * exercises the real verification path — no tunnel and no Chatwoot needed.
 *
 * --replay reuses the previous message id, which is how you check idempotency:
 * the second delivery must come back {"duplicate":true} and must NOT produce a
 * second reply in the conversation.
 */
import { createHmac } from "node:crypto";

const args = process.argv.slice(2);

function flag(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
}

const replay = args.includes("--replay");
const conversationId = Number(flag("conversation", "1"));
const content = args.filter((a) => !a.startsWith("--") && a !== flag("conversation")).at(-1);

if (!content) {
  console.error('Usage: bun run scripts/send-webhook.ts [--conversation N] [--replay] "message"');
  process.exit(1);
}

const secret = process.env.CHATWOOT_WEBHOOK_SECRET;
if (!secret) {
  console.error("CHATWOOT_WEBHOOK_SECRET is not set");
  process.exit(1);
}

const base = process.env.SERVICE_BASE_URL ?? "http://localhost:3003";

// Message ids must be stable across a --replay and distinct otherwise, since
// the webhook dedupes on `message_created:<id>`.
const stateFile = new URL("./.last-message-id", import.meta.url).pathname;
let messageId: number;
if (replay) {
  messageId = Number(await Bun.file(stateFile).text().catch(() => "0"));
  if (!messageId) {
    console.error("nothing to replay yet — send a message first");
    process.exit(1);
  }
} else {
  messageId = Date.now() % 2_000_000_000;
  await Bun.write(stateFile, String(messageId));
}

const body = JSON.stringify({
  event: "message_created",
  id: messageId,
  content,
  message_type: "incoming",
  private: false,
  conversation: { id: conversationId },
});

const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");

const url = `${base}/webhooks/chatwoot`;
console.log(`\nPOST ${url}`);
console.log(`  conversation ${conversationId}, message id ${messageId}${replay ? " (replay)" : ""}`);
console.log(`  ${JSON.stringify(content)}\n`);

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Chatwoot-Signature": `sha256=${signature}`,
    "X-Chatwoot-Timestamp": timestamp,
  },
  body,
});

console.log(`  ${res.status} ${await res.text()}\n`);
console.log(
  replay
    ? '  expected: {"ok":true,"duplicate":true} and no second reply in Chatwoot\n'
    : "  the reply is posted asynchronously — watch the dev server log\n",
);
