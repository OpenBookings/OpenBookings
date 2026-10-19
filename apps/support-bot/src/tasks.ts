import { CloudTasksClient } from "@google-cloud/tasks";
import { Receiver } from "@upstash/qstash";
import { OAuth2Client } from "google-auth-library";
import { env } from "./env";
import { trace } from "./trace";

/**
 * Task decoupling: webhooks enqueue and ack immediately; the queue POSTs the
 * task back to /tasks/<name> on this service. Three dispatchers:
 *
 * - **Cloud Tasks** (TASK_QUEUE=cloud-tasks, the default): the queue mints an
 *   OIDC token for our service account; the handler verifies it.
 * - **Upstash QStash** (TASK_QUEUE=qstash): QStash signs each delivery with a
 *   JWT over the body; the handler verifies it with the signing keys.
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

let tasksClient: CloudTasksClient | undefined;

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
      headers: { "Content-Type": "application/json", "X-CloudTasks-QueueName": "inline-dev" },
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

async function enqueueCloudTask(name: TaskName, payload: unknown, delaySeconds: number): Promise<void> {
  trace("tasks", "creating cloud task", { name, delaySeconds });
  tasksClient ??= new CloudTasksClient();
  const parent = tasksClient.queuePath(
    env.cloudTasksProject,
    env.cloudTasksQueueLocation,
    env.cloudTasksQueueName,
  );
  await tasksClient.createTask({
    parent,
    task: {
      ...(delaySeconds > 0
        ? { scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySeconds } }
        : {}),
      httpRequest: {
        httpMethod: "POST",
        url: taskUrl(name),
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify(payload)).toString("base64"),
        oidcToken: {
          serviceAccountEmail: env.tasksServiceAccountEmail,
          audience: env.serviceBaseUrl,
        },
      },
    },
  });
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

/** Enqueue a task on the configured queue, optionally delayed. */
export async function enqueueTask<N extends TaskName>(
  name: N,
  payload: TaskPayloads[N],
  opts: { delaySeconds?: number } = {},
): Promise<void> {
  const delaySeconds = Math.max(0, Math.floor(opts.delaySeconds ?? 0));
  if (env.tasksInline) return dispatchInline(name, payload, delaySeconds);
  if (env.taskQueue === "qstash") return enqueueQStash(name, payload, delaySeconds);
  return enqueueCloudTask(name, payload, delaySeconds);
}

export async function enqueueProcessConversation(payload: ProcessConversationPayload): Promise<void> {
  await enqueueTask("process-conversation", payload);
}

const oidcVerifier = new OAuth2Client();

/**
 * True when the request came from our Cloud Tasks queue: queue header present
 * and a valid Google OIDC token for our service account with this service as
 * audience. TASKS_AUTH_DISABLED=true bypasses for local development only.
 */
export async function verifyCloudTasksRequest(headers: {
  authorization?: string;
  queueName?: string;
}): Promise<boolean> {
  if (env.tasksAuthDisabled) {
    trace("tasks", "OIDC check bypassed (TASKS_AUTH_DISABLED)");
    return true;
  }
  if (!headers.queueName) {
    trace("tasks", "OIDC check failed: missing queue header");
    return false;
  }
  const token = headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) {
    trace("tasks", "OIDC check failed: missing bearer token");
    return false;
  }
  try {
    const ticket = await oidcVerifier.verifyIdToken({
      idToken: token,
      audience: env.serviceBaseUrl,
    });
    const claims = ticket.getPayload();
    const ok = claims?.email === env.tasksServiceAccountEmail && claims.email_verified === true;
    trace("tasks", ok ? "OIDC check passed" : "OIDC check failed: email mismatch", { email: claims?.email });
    return ok;
  } catch (err) {
    trace("tasks", "OIDC check failed: token verification error", { err: String(err) });
    return false;
  }
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

/** Authenticate a task delivery against whichever queue is configured. */
export async function verifyTaskRequest(req: {
  name: TaskName;
  rawBody: string;
  headers: { authorization?: string; queueName?: string; upstashSignature?: string };
}): Promise<boolean> {
  if (env.taskQueue === "qstash" && !env.tasksInline) {
    return verifyQStashRequest({ signature: req.headers.upstashSignature, rawBody: req.rawBody, name: req.name });
  }
  return verifyCloudTasksRequest(req.headers);
}
