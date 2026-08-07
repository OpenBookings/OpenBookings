import { env } from "../env";
import { trace } from "../trace";

/**
 * Minimal Chatwoot Application API client — only the calls the bot needs.
 * https://www.chatwoot.com/developers/api/
 */

export type ChatwootMessage = {
  id: number;
  content: string | null;
  message_type: number; // 0 incoming, 1 outgoing, 2 activity, 3 template
  private: boolean;
  created_at: number;
};

function accountUrl(path: string): string {
  return `${env.chatwootBaseUrl}/api/v1/accounts/${env.chatwootAccountId}${path}`;
}

async function chatwootFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  trace("chatwoot", `→ ${method} ${path}`, init?.body ? { body: init.body } : undefined);
  const res = await fetch(accountUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      api_access_token: env.chatwootApiToken,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    trace("chatwoot", `← ${res.status} ${method} ${path}`, { body: body.slice(0, 300) });
    throw new Error(`Chatwoot ${method} ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  trace("chatwoot", `← ${res.status} ${method} ${path}`);
  return (await res.json()) as T;
}

/** Fetch a conversation's messages, oldest first. */
export async function getConversationMessages(conversationId: number): Promise<ChatwootMessage[]> {
  const data = await chatwootFetch<{ payload: ChatwootMessage[] }>(
    `/conversations/${conversationId}/messages`,
  );
  return data.payload ?? [];
}

/** Post a public (guest-visible) outgoing reply. */
export async function postReply(conversationId: number, content: string): Promise<void> {
  await chatwootFetch(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, message_type: "outgoing", private: false }),
  });
}

/** Post an internal note only agents can see. */
export async function postPrivateNote(conversationId: number, content: string): Promise<void> {
  await chatwootFetch(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, message_type: "outgoing", private: true }),
  });
}

/** Flip conversation status (e.g. pending → open on escalation). */
export async function setConversationStatus(
  conversationId: number,
  status: "open" | "resolved" | "pending" | "snoozed",
): Promise<void> {
  await chatwootFetch(`/conversations/${conversationId}/toggle_status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}
