import { CloudTasksClient } from "@google-cloud/tasks";
import { OAuth2Client } from "google-auth-library";
import { env } from "./env";
import { trace } from "./trace";

/**
 * Cloud Tasks decoupling: the webhook enqueues, Cloud Tasks POSTs back to
 * /tasks/process-conversation with an OIDC token minted for our service
 * account. The handler verifies that token (plus the queue header) — Cloud
 * Run's native OIDC support on the queue, not a shared secret.
 */

export type ProcessConversationPayload = {
  eventId: string;
  conversationId: number;
  messageId: number;
  content: string;
};

let tasksClient: CloudTasksClient | undefined;

/**
 * Local-dev dispatch: POST straight to our own task handler instead of going
 * through a queue that does not exist outside GCP. Deliberately not awaited,
 * so the webhook still returns immediately the way it does in production —
 * but failures are logged, because a silent one here looks like the bot
 * simply never replying.
 */
function dispatchInline(payload: ProcessConversationPayload): void {
  const url = `${env.serviceBaseUrl}/tasks/process-conversation`;
  trace("tasks", "inline dispatch →", { url, eventId: payload.eventId });
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CloudTasks-QueueName": "inline-dev" },
    body: JSON.stringify(payload),
  })
    .then(async (res) => {
      if (res.ok) {
        trace("tasks", "inline dispatch ok", { eventId: payload.eventId });
        return;
      }
      const body = await res.text().catch(() => "");
      console.error(
        `[inline dispatch] ${url} -> ${res.status} ${body.slice(0, 200)}` +
          (res.status === 403 ? " (set TASKS_AUTH_DISABLED=true)" : ""),
      );
    })
    .catch((err) => console.error(`[inline dispatch] ${url} failed:`, err));
}

export async function enqueueProcessConversation(payload: ProcessConversationPayload): Promise<void> {
  if (env.tasksInline) {
    dispatchInline(payload);
    return;
  }
  trace("tasks", "creating cloud task", { eventId: payload.eventId });
  tasksClient ??= new CloudTasksClient();
  const parent = tasksClient.queuePath(
    env.cloudTasksProject,
    env.cloudTasksQueueLocation,
    env.cloudTasksQueueName,
  );
  await tasksClient.createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: "POST",
        url: `${env.serviceBaseUrl}/tasks/process-conversation`,
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
