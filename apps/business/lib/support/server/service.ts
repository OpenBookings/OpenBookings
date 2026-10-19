import {
  applySupportTicketStatus,
  getSupportContact,
  insertSupportTicket,
  isSupportTicketStatus,
  markSupportTicketSeen,
  recordSupportTicketMessage,
  saveSupportContact,
  type SupportSenderType,
} from "@openbookings/db";
import {
  ClientApiError,
  clientApi,
  handOffToHuman,
  setConversationStatus,
  supportFlags,
} from "@openbookings/support";
import { ATTACHMENT_LIMITS, attachmentProblem } from "../attachments";
import { findCategory, SUPPORT_MESSAGE_MAX, type LinkedKind } from "../categories";
import { mapChatwootMessage, type ChatMessage } from "../chat";
import { structuredOpener, ticketTitle } from "../title";
import type { TicketWithMessages } from "../types";
import type { InboxHours } from "../working-hours";
import {
  defaultPropertyId,
  getTicketAccess,
  resolveFollowUp,
  resolveLinked,
  type SupportScope,
} from "./tickets";

/**
 * Host support's server-side operations. Each one authorizes the session
 * against the ticket (org, and opener for writes) *before* calling Chatwoot.
 * Errors that reach the host are short and safe to show; details go to the
 * server log.
 */

export class SupportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportError";
  }
}

export function validateFiles(files: File[]): void {
  if (files.length > ATTACHMENT_LIMITS.maxFiles) {
    throw new SupportError(`Attach at most ${ATTACHMENT_LIMITS.maxFiles} files.`);
  }
  for (const file of files) {
    const problem = attachmentProblem(file);
    if (problem) throw new SupportError(`${file.name}: ${problem}`);
  }
}

function senderTypeOf(message: ChatMessage): SupportSenderType {
  return message.kind === "host" ? "contact" : message.kind === "assistant" ? "agent_bot" : "user";
}

function logChatwootFailure(step: string, err: unknown) {
  console.error("[support] %s failed:", step, err instanceof ClientApiError ? `${err.status} ${err.message}` : err);
}

/** The user's Chatwoot contact, created on their first ticket. */
async function ensureContact(scope: SupportScope) {
  const existing = await getSupportContact(scope.userId);
  if (existing) return existing;
  const created = await clientApi.createContact({
    identifier: scope.userId,
    name: scope.userName,
    email: scope.userEmail,
  });
  return saveSupportContact({
    user_id: scope.userId,
    chatwoot_contact_id: created.contactId,
    source_id: created.sourceId,
    pubsub_token: created.pubsubToken,
  });
}

/** The signed-in user's websocket room token, if they have a contact yet. */
export async function pubsubTokenFor(userId: string): Promise<string | null> {
  return (await getSupportContact(userId))?.pubsub_token ?? null;
}

export type CreateTicketInput = {
  category: string;
  linkedType: LinkedKind | null;
  linkedId: string | null;
  message: string;
  followUpOf: string | null;
  route: string | null;
  replayUrl: string | null;
  appVersion: string | null;
  files: File[];
};

/**
 * Open a ticket: a new Chatwoot conversation every time (never appended,
 * never deduped), its first message, then the local row. Nothing is
 * half-created: the row is only written once Chatwoot holds the
 * conversation and its first message.
 */
export async function createTicket(
  scope: SupportScope,
  input: CreateTicketInput,
): Promise<TicketWithMessages & { pubsubToken: string }> {
  const category = findCategory(input.category);
  if (!category) throw new SupportError("Pick a category.");
  const message = input.message.trim();
  if (message.length > SUPPORT_MESSAGE_MAX) {
    throw new SupportError(`Keep the message under ${SUPPORT_MESSAGE_MAX} characters.`);
  }
  validateFiles(input.files);

  // Linked items only where the category offers them, and only the org's own.
  let linked: { type: LinkedKind; id: string; label: string; propertyId: string } | null = null;
  if (input.linkedType && input.linkedId) {
    if (category.linked !== input.linkedType) throw new SupportError("That item can't be linked to this category.");
    const found = await resolveLinked(scope, input.linkedType, input.linkedId);
    if (!found) throw new SupportError("We couldn't find that item in your account.");
    linked = { type: input.linkedType, id: input.linkedId.toLowerCase(), ...found };
  }
  const followUpOf = input.followUpOf ? await resolveFollowUp(scope, input.followUpOf) : null;
  if (input.followUpOf && !followUpOf) throw new SupportError("That ticket can't be followed up.");
  const propertyId = linked?.propertyId ?? (await defaultPropertyId(scope));

  const contact = await ensureContact(scope);
  // Triage context, never asked of the host. No guest personal data here.
  const attributes: Record<string, string> = { category: category.id, org_id: scope.orgId };
  if (propertyId) attributes.property_id = propertyId;
  if (linked) {
    attributes.linked_type = linked.type;
    attributes.linked_id = linked.id;
  }
  if (followUpOf) attributes.follow_up_of = followUpOf;
  if (input.route) attributes.route = input.route.slice(0, 200);
  if (input.appVersion) attributes.app_version = input.appVersion.slice(0, 64);
  if (category.attachReplay && input.replayUrl) attributes.replay_url = input.replayUrl.slice(0, 500);

  // The public create stores the attributes (verified on 4.18), so no second
  // call as the agent is needed.
  const conversation = await clientApi.createConversation(contact.source_id, attributes);

  const assistant = supportFlags.assistantEnabled;
  let status = isSupportTicketStatus(conversation.status) ? conversation.status : "open";
  if (!assistant && status === "pending") {
    // No assistant: straight to the support team.
    await setConversationStatus(conversation.id, "open")
      .then(() => {
        status = "open";
      })
      .catch((err) => logChatwootFailure("opening the conversation", err));
  }

  let first: ChatMessage | null;
  try {
    const raw = await clientApi.createMessage(contact.source_id, conversation.id, {
      content: message || structuredOpener({ category: category.id, linkedLabel: linked?.label }),
      files: input.files,
    });
    first = mapChatwootMessage(raw);
  } catch (err) {
    // An empty conversation helps nobody: close it, and leave no local row.
    logChatwootFailure("posting the first message", err);
    await clientApi.resolveConversation(contact.source_id, conversation.id).catch(() => {});
    throw new SupportError("We couldn't start the chat. Please try again.");
  }

  const now = new Date();
  const ticketId = await insertSupportTicket({
    organizationId: scope.orgId,
    propertyId,
    openedByUserId: scope.userId,
    conversationId: conversation.id,
    category: category.id,
    linkedType: linked?.type ?? null,
    linkedId: linked?.id ?? null,
    followUpOf,
    title: ticketTitle({ category: category.id, linkedLabel: linked?.label, message }),
    status,
    lastMessage: first ? { at: new Date(first.createdAt), preview: first.content, sender: "contact" } : null,
  });
  await markSupportTicketSeen(ticketId, scope.userId, now);

  const access = await getTicketAccess(scope, ticketId);
  if (!access) throw new SupportError("We couldn't open the new ticket.");
  return { ticket: access.ticket, messages: first ? [first] : [], pubsubToken: contact.pubsub_token };
}

/**
 * A ticket and its messages, straight from Chatwoot. Also brings the local
 * row up to date (status, last message), so the list stays right even if a
 * webhook was missed.
 */
export async function loadTicket(scope: SupportScope, ticketId: string): Promise<TicketWithMessages> {
  const access = await getTicketAccess(scope, ticketId);
  if (!access) throw new SupportError("Ticket not found.");
  if (!access.openerSourceId) {
    return { ticket: access.ticket, messages: [] };
  }
  const [raw, conversation] = await Promise.all([
    clientApi.listMessages(access.openerSourceId, access.conversationId),
    clientApi.getConversation(access.openerSourceId, access.conversationId),
  ]);
  const messages = raw.map(mapChatwootMessage).filter((m): m is ChatMessage => m !== null);

  let changed = false;
  if (conversation.status !== access.ticket.status && isSupportTicketStatus(conversation.status)) {
    changed = await applySupportTicketStatus(access.conversationId, conversation.status);
  }
  const last = messages.at(-1);
  if (last) {
    changed =
      (await recordSupportTicketMessage(access.conversationId, {
        at: new Date(last.createdAt),
        content: last.content,
        sender: senderTypeOf(last),
      })) !== null || changed;
  }
  const ticket = changed ? ((await getTicketAccess(scope, ticketId))?.ticket ?? access.ticket) : access.ticket;
  return { ticket, messages };
}

async function writableTicket(scope: SupportScope, ticketId: string) {
  const access = await getTicketAccess(scope, ticketId);
  if (!access) throw new SupportError("Ticket not found.");
  if (!access.canWrite || !access.openerSourceId) throw new SupportError("Only the person who opened this ticket can reply.");
  return access as typeof access & { openerSourceId: string };
}

/** Post a host message. Refused on resolved tickets: Chatwoot would reopen them. */
export async function sendMessage(
  scope: SupportScope,
  ticketId: string,
  input: { content: string; files: File[] },
): Promise<ChatMessage> {
  const content = input.content.trim();
  if (!content && input.files.length === 0) throw new SupportError("Write a message first.");
  if (content.length > SUPPORT_MESSAGE_MAX) {
    throw new SupportError(`Keep the message under ${SUPPORT_MESSAGE_MAX} characters.`);
  }
  validateFiles(input.files);

  const access = await writableTicket(scope, ticketId);
  // Chatwoot is the authority on status; our row can lag a webhook.
  const conversation = await clientApi.getConversation(access.openerSourceId, access.conversationId);
  if (conversation.status === "resolved" || access.ticket.status === "resolved") {
    if (access.ticket.status !== "resolved") await applySupportTicketStatus(access.conversationId, "resolved");
    throw new SupportError("This ticket is resolved. Open a new ticket to continue.");
  }

  const raw = await clientApi.createMessage(access.openerSourceId, access.conversationId, {
    content,
    files: input.files,
  });
  const message = mapChatwootMessage(raw);
  if (!message) throw new SupportError("The message was sent but couldn't be shown. Reload to see it.");
  await recordSupportTicketMessage(access.conversationId, {
    at: new Date(message.createdAt),
    content: message.content,
    sender: "contact",
  });
  await markSupportTicketSeen(access.ticket.id, scope.userId);
  return message;
}

export async function resolveTicket(scope: SupportScope, ticketId: string): Promise<void> {
  const access = await writableTicket(scope, ticketId);
  if (access.ticket.status === "resolved") return;
  await clientApi.resolveConversation(access.openerSourceId, access.conversationId);
  await applySupportTicketStatus(access.conversationId, "resolved");
}

/**
 * "Talk to a person" and "No" to the answer check: the same hand-off the
 * bot's escalate_to_human uses.
 */
export async function requestPerson(scope: SupportScope, ticketId: string, reason: "asked" | "not_answered"): Promise<void> {
  const access = await writableTicket(scope, ticketId);
  if (access.ticket.status !== "pending") return;
  const note =
    reason === "asked"
      ? "**Hand-off from the support panel**\n\nThe host pressed “Talk to a person”."
      : "**Hand-off from the support panel**\n\nThe host said the assistant's answer didn't help.";
  await handOffToHuman(access.conversationId, note);
  await applySupportTicketStatus(access.conversationId, "open");
}

export async function setTyping(scope: SupportScope, ticketId: string, on: boolean): Promise<void> {
  const access = await writableTicket(scope, ticketId);
  await clientApi.toggleContactTyping(access.openerSourceId, access.conversationId, on);
}

export async function markSeen(scope: SupportScope, ticketId: string): Promise<void> {
  const access = await getTicketAccess(scope, ticketId);
  if (!access) return;
  await markSupportTicketSeen(access.ticket.id, scope.userId);
  // Read receipts for the support team only make sense from the opener.
  if (access.canWrite && access.openerSourceId) {
    await clientApi.updateContactLastSeen(access.openerSourceId, access.conversationId).catch((err) =>
      logChatwootFailure("updating last seen", err),
    );
  }
}

let hoursCache: { at: number; value: InboxHours | null } | null = null;
const HOURS_TTL_MS = 10 * 60 * 1000;

/** The inbox's working hours, cached for ten minutes per server instance. */
export async function inboxHours(): Promise<InboxHours | null> {
  if (hoursCache && Date.now() - hoursCache.at < HOURS_TTL_MS) return hoursCache.value;
  try {
    const info = await clientApi.getInboxInfo();
    hoursCache = { at: Date.now(), value: { timezone: info.timezone, workingHours: info.workingHours } };
  } catch (err) {
    logChatwootFailure("loading working hours", err);
    hoursCache = { at: Date.now(), value: null };
  }
  return hoursCache.value;
}
