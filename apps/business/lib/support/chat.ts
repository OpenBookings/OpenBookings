/**
 * The support chat's message model, shared by the server (which maps
 * Chatwoot's REST payloads) and the browser (which maps websocket events and
 * keeps optimistic copies). Pure.
 *
 * Who wrote a message decides how it is labelled, and the host must always be
 * able to tell the assistant from a person (EU AI Act Art. 50): so the kind
 * comes from Chatwoot's sender type, never from content.
 */

export type ChatSenderKind = "host" | "assistant" | "person";

export type ChatAttachment = {
  id: number;
  kind: "image" | "file";
  url: string;
  thumbUrl: string | null;
  name: string;
  size: number | null;
};

export type ChatMessage = {
  /** `cw:<chatwoot id>` once stored, `tmp:<uuid>` while optimistic. */
  key: string;
  chatwootId: number | null;
  kind: ChatSenderKind;
  content: string;
  /** Epoch milliseconds. */
  createdAt: number;
  senderName: string | null;
  attachments: ChatAttachment[];
  state: "sending" | "sent" | "failed";
};

/** The fields of a Chatwoot message (REST or websocket) this reads. */
export type RawChatwootMessage = {
  id: number;
  content?: string | null;
  message_type: number | string;
  created_at: number | string;
  private?: boolean;
  sender?: { name?: string | null; available_name?: string | null; type?: string | null } | null;
  sender_type?: string | null;
  attachments?: Array<{
    id: number;
    file_type?: string | null;
    data_url?: string | null;
    thumb_url?: string | null;
    file_size?: number | null;
  }> | null;
};

function messageType(raw: number | string): number {
  if (typeof raw === "number") return raw;
  return { incoming: 0, outgoing: 1, activity: 2, template: 3 }[raw] ?? -1;
}

function normalizedSender(raw: RawChatwootMessage): string {
  return (raw.sender?.type ?? raw.sender_type ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

function toMillis(value: number | string): number {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function attachmentName(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    return last ? decodeURIComponent(last) : "Attachment";
  } catch {
    return "Attachment";
  }
}

/** Only http(s) URLs ever reach an `href` or `src`. */
function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Map a Chatwoot message for display. Returns null for anything the host must
 * not see or that isn't conversation: private notes (even if the API returns
 * one), activity lines and templates. Hand-off and resolve lines come from
 * the ticket's own timestamps instead (see `timeline`).
 */
export function mapChatwootMessage(raw: RawChatwootMessage): ChatMessage | null {
  if (raw.private === true) return null;
  const type = messageType(raw.message_type);
  if (type !== 0 && type !== 1) return null;

  let kind: ChatSenderKind;
  let senderName: string | null = null;
  if (type === 0) {
    kind = "host";
  } else {
    const sender = normalizedSender(raw);
    if (sender === "agentbot") {
      kind = "assistant";
    } else {
      // A person, or an automated system message with no sender: either way
      // not the AI, so never labelled as the assistant.
      kind = "person";
      senderName = raw.sender?.available_name?.trim() || raw.sender?.name?.trim() || null;
    }
  }

  const attachments: ChatAttachment[] = [];
  for (const a of raw.attachments ?? []) {
    const url = safeUrl(a.data_url);
    if (!url) continue;
    attachments.push({
      id: a.id,
      kind: a.file_type === "image" ? "image" : "file",
      url,
      thumbUrl: safeUrl(a.thumb_url),
      name: attachmentName(url),
      size: typeof a.file_size === "number" ? a.file_size : null,
    });
  }

  return {
    key: `cw:${raw.id}`,
    chatwootId: raw.id,
    kind,
    content: raw.content ?? "",
    createdAt: toMillis(raw.created_at),
    senderName,
    attachments,
    state: "sent",
  };
}

/**
 * Merge incoming stored messages into the list by Chatwoot id. A stored host
 * message also replaces the optimistic copy with the same text (the websocket
 * can deliver it before the POST that created it returns).
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byKey = new Map(current.map((m) => [m.key, m]));
  for (const message of incoming) {
    if (message.kind === "host" && !byKey.has(message.key)) {
      const optimistic = [...byKey.values()].find(
        (m) => m.chatwootId === null && m.state === "sending" && m.content === message.content,
      );
      if (optimistic) byKey.delete(optimistic.key);
    }
    byKey.set(message.key, message);
  }
  return [...byKey.values()].sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
}

export type TimelineItem =
  | { type: "group"; key: string; kind: ChatSenderKind; senderName: string | null; messages: ChatMessage[] }
  | { type: "activity"; key: string; text: string; at: number };

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Messages grouped by sender (consecutive, within 5 minutes), with the
 * hand-off and resolve lines placed at their time.
 */
export function timeline(
  messages: ChatMessage[],
  ticket: { handedOffAt: number | null; resolvedAt: number | null; status: string },
): TimelineItem[] {
  const activities: Array<{ type: "activity"; key: string; text: string; at: number }> = [];
  if (ticket.handedOffAt) {
    activities.push({ type: "activity", key: "handoff", text: "Ticket went to the support team", at: ticket.handedOffAt });
  }
  if (ticket.status === "resolved" && ticket.resolvedAt) {
    activities.push({ type: "activity", key: "resolved", text: "Ticket resolved", at: ticket.resolvedAt });
  }

  const items: TimelineItem[] = [];
  let ai = 0;
  for (const message of messages) {
    while (ai < activities.length && activities[ai]!.at <= message.createdAt) items.push(activities[ai++]!);
    const last = items.at(-1);
    const lastMessage = last?.type === "group" ? last.messages.at(-1) : undefined;
    if (
      last?.type === "group" &&
      last.kind === message.kind &&
      last.senderName === message.senderName &&
      lastMessage &&
      message.createdAt - lastMessage.createdAt <= GROUP_WINDOW_MS
    ) {
      last.messages.push(message);
    } else {
      items.push({ type: "group", key: message.key, kind: message.kind, senderName: message.senderName, messages: [message] });
    }
  }
  while (ai < activities.length) items.push(activities[ai++]!);
  return items;
}

/** The latest message that isn't the host's, if it's the last thing said. */
export function awaitingReply(messages: ChatMessage[]): boolean {
  const last = messages.at(-1);
  return last?.kind === "host";
}

export function lastAssistantMessage(messages: ChatMessage[]): ChatMessage | null {
  const last = messages.at(-1);
  return last?.kind === "assistant" ? last : null;
}
