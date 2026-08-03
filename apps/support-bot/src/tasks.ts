import { CloudTasksClient } from "@google-cloud/tasks";
import { OAuth2Client } from "google-auth-library";
import { env } from "./env";

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

export async function enqueueProcessConversation(payload: ProcessConversationPayload): Promise<void> {
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
  if (env.tasksAuthDisabled) return true;
  if (!headers.queueName) return false;
  const token = headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return false;
  try {
    const ticket = await oidcVerifier.verifyIdToken({
      idToken: token,
      audience: env.serviceBaseUrl,
    });
    const claims = ticket.getPayload();
    return claims?.email === env.tasksServiceAccountEmail && claims.email_verified === true;
  } catch {
    return false;
  }
}
