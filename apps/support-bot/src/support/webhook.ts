import {
  applySupportTicketStatus,
  backfillSupportTicket,
  findSupportTicketByConversation,
  isSupportTicketStatus,
  recordProcessedEvent,
  recordSupportTicketMessage,
  supportPreview,
  type SupportSenderType,
  type SupportTicketStatus,
} from "@openbookings/db";
import { env } from "../env";
import { enqueueTask } from "../tasks";
import { trace } from "../trace";

/**
 * The Business support webhook: keeps `support_tickets` in step with
 * Chatwoot (status, last message, activity) and schedules reply emails. It
 * never replies to anyone — that is the bot's job on /webhooks/chatwoot.
 *
 * Signature verification happens in the route; this module gets the parsed,
 * verified body.
 */

/** A host who hasn't looked at the reply within this long gets an email. */
export const REPLY_EMAIL_DELAY_SECONDS = 10 * 60;

type Conversation = {
  id?: number;
  inbox_id?: number;
  status?: string;
  created_at?: number | string;
  custom_attributes?: Record<string, unknown> | null;
  meta?: { sender?: { identifier?: string | null } | null } | null;
};

export type SupportWebhookPayload = Conversation & {
  event?: string;
  // message_created
  content?: string | null;
  message_type?: string | number;
  private?: boolean;
  sender?: { type?: string | null; identifier?: string | null } | null;
  inbox?: { id?: number } | null;
  conversation?: Conversation | null;
};

/** Chatwoot timestamps arrive as unix seconds or ISO strings depending on the payload. */
export function parseChatwootTime(value: number | string | undefined | null): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function senderType(raw: string | null | undefined): SupportSenderType | null {
  const value = raw?.toLowerCase().replace(/[^a-z]/g, "");
  if (value === "contact") return "contact";
  if (value === "user") return "user";
  if (value === "agentbot") return "agent_bot";
  return null;
}

function isBusinessInbox(inboxId: number | undefined): boolean {
  const configured = env.businessInboxId;
  return configured !== null && inboxId === configured;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Create the ticket row if the business app's own insert never landed. The
 * DB function re-checks org membership, so a forged custom attribute can't
 * place a ticket in someone else's org.
 */
async function backfill(conversation: Conversation, fallbackSender?: string | null): Promise<void> {
  const id = conversation.id;
  const attrs = conversation.custom_attributes ?? {};
  const orgId = text(attrs.org_id);
  const category = text(attrs.category);
  const openerId = text(conversation.meta?.sender?.identifier) ?? text(fallbackSender);
  if (typeof id !== "number" || !orgId || !category || !openerId) {
    trace("support", "backfill skipped: missing attributes", { conversationId: id });
    return;
  }
  const status: SupportTicketStatus = isSupportTicketStatus(conversation.status) ? conversation.status : "pending";
  const inserted = await backfillSupportTicket({
    conversationId: id,
    organizationId: orgId,
    openedByUserId: openerId,
    propertyId: text(attrs.property_id),
    category,
    title: "Support request",
    status,
    createdAt: parseChatwootTime(conversation.created_at) ?? new Date(),
  });
  trace("support", inserted ? "backfilled ticket" : "backfill refused", { conversationId: id });
}

export async function handleSupportEvent(payload: SupportWebhookPayload): Promise<{ ignored?: true }> {
  switch (payload.event) {
    case "conversation_created": {
      if (!isBusinessInbox(payload.inbox_id) || typeof payload.id !== "number") return { ignored: true };
      if (!(await findSupportTicketByConversation(payload.id))) await backfill(payload);
      return {};
    }

    case "conversation_status_changed": {
      if (!isBusinessInbox(payload.inbox_id) || typeof payload.id !== "number") return { ignored: true };
      if (!isSupportTicketStatus(payload.status)) return { ignored: true };
      if (!(await findSupportTicketByConversation(payload.id))) await backfill(payload);
      await applySupportTicketStatus(payload.id, payload.status, new Date());
      return {};
    }

    case "message_created": {
      const conversation = payload.conversation ?? {};
      const inboxId = payload.inbox?.id ?? conversation.inbox_id;
      if (!isBusinessInbox(inboxId) || typeof conversation.id !== "number") return { ignored: true };
      // Internal notes and activity lines never surface to the host.
      const type = payload.message_type;
      const isPublic = type === "incoming" || type === 0 || type === "outgoing" || type === 1;
      if (payload.private === true || !isPublic || typeof payload.id !== "number") return { ignored: true };

      const sender = senderType(payload.sender?.type);
      if (!sender) return { ignored: true };
      const at = parseChatwootTime(payload.created_at) ?? new Date();

      if (!(await findSupportTicketByConversation(conversation.id))) {
        await backfill(conversation, sender === "contact" ? payload.sender?.identifier : null);
      }
      const changed = await recordSupportTicketMessage(conversation.id, {
        at,
        content: supportPreview(payload.content),
        sender,
      });

      // A reply from the assistant or a person: email the host later if they
      // haven't seen it by then. Deduped per message, because a webhook retry
      // must not queue a second check.
      if (changed && sender !== "contact") {
        const first = await recordProcessedEvent(`support_message_created:${payload.id}`);
        if (first) {
          await enqueueTask(
            "support-reply-notify",
            { conversationId: conversation.id, messageAt: at.toISOString() },
            { delaySeconds: REPLY_EMAIL_DELAY_SECONDS },
          );
        }
      }
      return {};
    }

    default:
      return { ignored: true };
  }
}
