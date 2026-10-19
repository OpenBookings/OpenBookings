import type { LinkedKind } from "./categories";
import type { ChatMessage } from "./chat";
import type { TicketStatus } from "./status";
import type { InboxHours } from "./working-hours";

/** What the browser may know about a ticket. Never carries Chatwoot credentials. */
export type TicketSummary = {
  id: string;
  /** Chatwoot display id, shown as `#1234`. */
  reference: number;
  title: string;
  category: string;
  status: TicketStatus;
  linked: { type: LinkedKind; id: string; label: string } | null;
  lastMessagePreview: string | null;
  /** ISO timestamp. */
  lastActivityAt: string;
  unread: boolean;
  /** True when the signed-in user opened it (and so may write in it). */
  mine: boolean;
  openedBy: { id: string; name: string } | null;
};

export type TicketDetail = TicketSummary & {
  handedOffAt: string | null;
  resolvedAt: string | null;
  followUpOf: string | null;
  /** Someone else's ticket, viewed by an owner/admin: no composer, no realtime. */
  readOnly: boolean;
};

export type TicketWithMessages = { ticket: TicketDetail; messages: ChatMessage[] };

/** Everything the panel needs on first paint, from the dashboard layout. */
export type SupportBootstrap = {
  assistantEnabled: boolean;
  /** `wss://…/cable`, or null when the browser shouldn't connect. */
  websocketUrl: string | null;
  /** The signed-in user's Chatwoot room token; null until their first ticket. */
  pubsubToken: string | null;
  hours: InboxHours | null;
  openTickets: TicketSummary[];
  unreadCount: number;
  /** For telling app links from external ones in replies. */
  appOrigin: string | null;
};

export type LinkOption = {
  type: LinkedKind;
  id: string;
  /** "Booking #0a1b2c3d" or the property name. */
  label: string;
  /** Guest and dates, or the city. */
  detail: string;
};

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
