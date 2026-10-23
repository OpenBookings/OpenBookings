import { Receiver } from "@upstash/qstash";
import { env } from "./env";
import { trace } from "./trace";

/**
 * Task decoupling: webhooks enqueue and ack immediately; the queue POSTs the
 * task back to /tasks/<name> on this service. Two dispatchers:
 *
 * - **Upstash QStash**: QStash signs each delivery with a JWT over the body;
 *   the handler verifies it with the signing keys.
 * - **Inline** (TASKS_INLINE=true, local dev only): POST to ourselves.
 */

export type ProcessConversationPayload = {
  eventId: string;
  conversationId: number;
  messageId: number;
  content: string;
  /**
   * Email of the Chatwoot contact who sent the message, or null for an
   * anonymous contact. Read off the HMAC-verified webhook body and carried
   * here so the async side never has to trust message content for identity;
   * the task itself is authenticated, so this field is not guest-writable.
   * Always null for host tickets: a host's email must never reach the guest
   * tools.
   */
  guestEmail: string | null;
  /** Who wrote: a guest (default, guest inboxes) or a host (Business support inbox). */
  audience?: "guest" | "host";
  /**
   * Host tickets only: the business user id, from the Chatwoot contact's
   * identifier. Chatwoot only accepts that identifier with a valid HMAC from
   * our server, so it is as trustworthy as the session that created it.
   */
  hostUserId?: string | null;
  /** Host tickets only: what the intake recorded on the conversation. */
  ticket?: { category: string | null; linkedType: string | null; linkedId: string | null };
};

export type SupportReplyNotifyPayload = {
  conversationId: number;
  /** ISO time of the reply that triggered the check. */
  messageAt: string;
};

export type TaskPayloads = {
  "process-conversation": ProcessConversationPayload;
  "support-reply-notify": SupportReplyNotifyPayload;
};
export type TaskName = keyof TaskPayloads;

function taskUrl(name: TaskName): string {
  return `${env.serviceBaseUrl}/tasks/${name}`;
}

/**
 * Local-dev dispatch: POST straight to our own task handler instead of going
 * through a queue that does not exist outside the cloud. Deliberately not
 * awaited, so the webhook still returns immediately the way it does in
 * production — but failures are logged, because a silent one here looks like
 * the bot simply never replying.
 */
function dispatchInline(name: TaskName, payload: unknown, delaySeconds: number): void {
  const url = taskUrl(name);
  trace("tasks", "inline dispatch →", { url, delaySeconds });
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        if (res.ok) {
          trace("tasks", "inline dispatch ok", { name });
          return;
        }
        const body = await res.text().catch(() => "");
        // Format specifiers with the values as separate arguments: the response
        // body is remote input and must never be read as the format string.
        console.error(
          "[inline dispatch] %s -> %s %s%s",
          url,
          res.status,
          body.slice(0, 200),
          res.status === 403 ? " (set TASKS_AUTH_DISABLED=true)" : "",
        );
      })
      .catch((err) => console.error("[inline dispatch] %s failed:", url, err));
  if (delaySeconds > 0) setTimeout(send, delaySeconds * 1000);
  else void send();
}

async function enqueueQStash(name: TaskName, payload: unknown, delaySeconds: number): Promise<void> {
  trace("tasks", "publishing to qstash", { name, delaySeconds });
  const res = await fetch(`${env.qstashUrl}/v2/publish/${taskUrl(name)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.qstashToken}`,
      "Content-Type": "application/json",
      ...(delaySeconds > 0 ? { "Upstash-Delay": `${delaySeconds}s` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`QStash publish failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

/** Enqueue a task on QStash (or inline in local dev), optionally delayed. */
export async function enqueueTask<N extends TaskName>(
  name: N,
  payload: TaskPayloads[N],
  opts: { delaySeconds?: number } = {},
): Promise<void> {
  const delaySeconds = Math.max(0, Math.floor(opts.delaySeconds ?? 0));
  if (env.tasksInline) return dispatchInline(name, payload, delaySeconds);
  return enqueueQStash(name, payload, delaySeconds);
}

export async function enqueueProcessConversation(payload: ProcessConversationPayload): Promise<void> {
  await enqueueTask("process-conversation", payload);
}

let qstashReceiver: Receiver | undefined;

/**
 * True when the request is a genuine QStash delivery of this exact body to
 * this exact task URL. QStash signs a JWT whose claims bind the body hash and
 * the destination, so a captured delivery can't be replayed elsewhere.
 */
export async function verifyQStashRequest(req: {
  signature?: string;
  rawBody: string;
  name: TaskName;
}): Promise<boolean> {
  if (env.tasksAuthDisabled) {
    trace("tasks", "QStash check bypassed (TASKS_AUTH_DISABLED)");
    return true;
  }
  if (!req.signature) return false;
  qstashReceiver ??= new Receiver({
    currentSigningKey: env.qstashCurrentSigningKey,
    nextSigningKey: env.qstashNextSigningKey,
  });
  try {
    return await qstashReceiver.verify({
      signature: req.signature,
      body: req.rawBody,
      url: taskUrl(req.name),
      clockTolerance: 5,
    });
  } catch (err) {
    trace("tasks", "QStash check failed", { err: String(err) });
    return false;
  }
}

/** Authenticate a task delivery. */
export async function verifyTaskRequest(req: {
  name: TaskName;
  rawBody: string;
  headers: { upstashSignature?: string };
}): Promise<boolean> {
  return verifyQStashRequest({ signature: req.headers.upstashSignature, rawBody: req.rawBody, name: req.name });
}
