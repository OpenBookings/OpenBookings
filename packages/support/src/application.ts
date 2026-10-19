import { chatwootConfig } from "./config";
import { trace } from "./trace";
import type { ChatwootMessage, ChatwootStatus } from "./types";

/**
 * Chatwoot Application API — the agent side, authenticated with the Agent
 * Bot's access token. Used by the support bot to reply and hand off, and by
 * the business app for the steps the Client API can't do (custom attributes,
 * hand-off). https://www.chatwoot.com/developers/api/
 *
 * Conversation ids here are Chatwoot display ids, which is what every
 * Chatwoot API and webhook payload calls `id`.
 */

function accountUrl(path: string): string {
  return `${chatwootConfig.baseUrl}/api/v1/accounts/${chatwootConfig.accountId}${path}`;
}

async function applicationFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  trace("chatwoot", `→ ${method} ${path}`, init?.body ? { body: init.body } : undefined);
  const res = await fetch(accountUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      api_access_token: chatwootConfig.apiToken,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    trace("chatwoot", `← ${res.status} ${method} ${path}`, { body: body.slice(0, 300) });
    throw new Error(`Chatwoot ${method} ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  trace("chatwoot", `← ${res.status} ${method} ${path}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Fetch a conversation's messages, oldest first. */
export async function getConversationMessages(conversationId: number): Promise<ChatwootMessage[]> {
  const data = await applicationFetch<{ payload: ChatwootMessage[] }>(
    `/conversations/${conversationId}/messages`,
  );
  return data.payload ?? [];
}

/** Post a public (contact-visible) outgoing reply. */
export async function postReply(conversationId: number, content: string): Promise<void> {
  await applicationFetch(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, message_type: "outgoing", private: false }),
  });
}

/** Post an internal note only agents can see. */
export async function postPrivateNote(conversationId: number, content: string): Promise<void> {
  await applicationFetch(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, message_type: "outgoing", private: true }),
  });
}

/** Set the conversation status (e.g. pending → open on hand-off). */
export async function setConversationStatus(
  conversationId: number,
  status: ChatwootStatus,
): Promise<void> {
  await applicationFetch(`/conversations/${conversationId}/toggle_status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

/** Show or clear the agent-side typing indicator on the contact's screen. */
export async function setTypingStatus(conversationId: number, on: boolean): Promise<void> {
  await applicationFetch(`/conversations/${conversationId}/toggle_typing_status`, {
    method: "POST",
    body: JSON.stringify({ typing_status: on ? "on" : "off" }),
  });
}

/**
 * Merge custom attributes into a conversation. Without `merge: true`
 * Chatwoot *replaces* the whole set (verified on 4.18). Each key must be
 * defined under Settings → Custom attributes (conversation) to show in the UI.
 */
export async function setConversationCustomAttributes(
  conversationId: number,
  customAttributes: Record<string, string | number | boolean | null>,
): Promise<void> {
  await applicationFetch(`/conversations/${conversationId}/custom_attributes`, {
    method: "POST",
    body: JSON.stringify({ custom_attributes: customAttributes, merge: true }),
  });
}
