import { chatwootConfig } from "./config";
import { identifierHash } from "./identity";
import { trace } from "./trace";
import type { ChatwootMessage, ChatwootStatus, InboxInfo, WorkingHoursDay } from "./types";

/**
 * Chatwoot's public Client API for the Business support API inbox — the
 * contact side. Server-only: a contact's `source_id` lets whoever holds it
 * read and write that contact's conversations.
 *
 * Verified against Chatwoot 4.18 (see the README): contact creation enforces
 * the HMAC identifier hash; create-conversation stores `custom_attributes`
 * (it just doesn't echo them); conversations start `pending` only when an
 * Agent Bot is attached to the inbox; a message posted after resolve
 * *reopens* the conversation, so callers must refuse it themselves.
 */

export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

function inboxUrl(path = ""): string {
  return `${chatwootConfig.baseUrl}/public/api/v1/inboxes/${encodeURIComponent(chatwootConfig.inboxIdentifier)}${path}`;
}

function conversationPath(sourceId: string, conversationId: number, rest = ""): string {
  return `/contacts/${encodeURIComponent(sourceId)}/conversations/${conversationId}${rest}`;
}

async function clientFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const method = init?.method ?? "GET";
  const { json, ...rest } = init ?? {};
  // The path carries the source_id, which is a credential: trace the shape only.
  trace("cw-client", `→ ${method} ${path.replace(/contacts\/[^/]+/, "contacts/…")}`);
  const res = await fetch(inboxUrl(path), {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json" } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    trace("cw-client", `← ${res.status} ${method}`, { body: body.slice(0, 200) });
    throw new ClientApiError(`Chatwoot Client API ${method} failed: ${res.status}`, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export type CreatedContact = { contactId: number; sourceId: string; pubsubToken: string };

/** Create (or re-attach) the contact for a user, signed with the inbox HMAC token. */
export async function createContact(input: {
  identifier: string;
  name: string;
  email: string;
}): Promise<CreatedContact> {
  const data = await clientFetch<{ id: number; source_id: string; pubsub_token: string }>(
    "/contacts",
    {
      method: "POST",
      json: {
        identifier: input.identifier,
        identifier_hash: identifierHash(input.identifier, chatwootConfig.hmacToken),
        name: input.name,
        email: input.email,
      },
    },
  );
  if (!data.source_id || !data.pubsub_token) {
    throw new ClientApiError("Chatwoot returned a contact without credentials", 502);
  }
  return { contactId: data.id, sourceId: data.source_id, pubsubToken: data.pubsub_token };
}

export type ConversationSummary = { id: number; status: ChatwootStatus };

export async function createConversation(
  sourceId: string,
  customAttributes: Record<string, string | number | boolean | null> = {},
): Promise<ConversationSummary> {
  const data = await clientFetch<{ id: number; status: ChatwootStatus }>(
    `/contacts/${encodeURIComponent(sourceId)}/conversations`,
    { method: "POST", json: { custom_attributes: customAttributes } },
  );
  return { id: data.id, status: data.status };
}

export async function getConversation(
  sourceId: string,
  conversationId: number,
): Promise<ConversationSummary> {
  const data = await clientFetch<{ id: number; status: ChatwootStatus }>(
    conversationPath(sourceId, conversationId),
  );
  return { id: data.id, status: data.status };
}

export async function listMessages(
  sourceId: string,
  conversationId: number,
): Promise<ChatwootMessage[]> {
  const data = await clientFetch<ChatwootMessage[]>(conversationPath(sourceId, conversationId, "/messages"));
  return Array.isArray(data) ? data : [];
}

/** Post a message as the contact. Files go up as multipart `attachments[]`. */
export async function createMessage(
  sourceId: string,
  conversationId: number,
  message: { content: string; echoId?: string; files?: File[] },
): Promise<ChatwootMessage> {
  const path = conversationPath(sourceId, conversationId, "/messages");
  if (message.files?.length) {
    const form = new FormData();
    form.append("content", message.content);
    if (message.echoId) form.append("echo_id", message.echoId);
    for (const file of message.files) form.append("attachments[]", file, file.name);
    return clientFetch<ChatwootMessage>(path, { method: "POST", body: form });
  }
  return clientFetch<ChatwootMessage>(path, {
    method: "POST",
    json: { content: message.content, ...(message.echoId ? { echo_id: message.echoId } : {}) },
  });
}

export async function toggleContactTyping(
  sourceId: string,
  conversationId: number,
  on: boolean,
): Promise<void> {
  await clientFetch(conversationPath(sourceId, conversationId, "/toggle_typing"), {
    method: "POST",
    json: { typing_status: on ? "on" : "off" },
  });
}

export async function updateContactLastSeen(sourceId: string, conversationId: number): Promise<void> {
  await clientFetch(conversationPath(sourceId, conversationId, "/update_last_seen"), { method: "POST" });
}

/** The contact resolving their own conversation. */
export async function resolveConversation(sourceId: string, conversationId: number): Promise<void> {
  await clientFetch(conversationPath(sourceId, conversationId, "/toggle_status"), { method: "POST" });
}

/** Public inbox details: name, timezone and working hours. */
export async function getInboxInfo(): Promise<InboxInfo> {
  const data = await clientFetch<{ name: string; timezone: string; working_hours?: WorkingHoursDay[] }>("");
  return { name: data.name, timezone: data.timezone || "UTC", workingHours: data.working_hours ?? [] };
}
