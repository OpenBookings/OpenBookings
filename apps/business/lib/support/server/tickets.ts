import { queryOne } from "@openbookings/db";
import { getOrgScopedDb, propertyReadAccessSql } from "@openbookings/authz";
import type { LinkedKind } from "../categories";
import { isUuid, shortBookingRef } from "../references";
import { tabStatuses, type TicketStatus, type TicketTab } from "../status";
import type { LinkOption, TicketDetail, TicketSummary } from "../types";

/**
 * Org-scoped reads for host support. Every query runs through
 * getOrgScopedDb, which takes the org from the session (never from input)
 * and re-checks membership on each call; the org id is always `$1`.
 *
 * Visibility: members see the tickets they opened; owners and admins see
 * every ticket of the org, read-only when someone else opened it.
 */

export type SupportScope = {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string;
  canSeeAll: boolean;
  db: NonNullable<Awaited<ReturnType<typeof getOrgScopedDb>>>;
};

type SessionWithUser = {
  user: { id: string; name?: string | null; email: string; account_type?: string | null };
  session: Record<string, unknown>;
};

/**
 * The org to scope to: the session's active org (the org plugin's
 * `activeOrganizationId`), or — for a session minted before the user had an
 * org — their only membership. getOrgScopedDb re-verifies membership either way.
 */
async function activeOrgId(session: SessionWithUser): Promise<string | null> {
  const active = session.session.activeOrganizationId;
  if (typeof active === "string" && active) return active;
  const row = await queryOne<{ id: string; n: number }>(
    `SELECT min("organizationId") AS id, count(*)::int AS n FROM "member" WHERE "userId" = $1`,
    [session.user.id],
  );
  return row?.n === 1 ? row.id : null;
}

export async function supportScope(session: SessionWithUser | null | undefined): Promise<SupportScope | null> {
  if (!session) return null;
  const orgId = await activeOrgId(session);
  const db = await getOrgScopedDb({ user: session.user, session: { activeOrganizationId: orgId } });
  if (!db) return null;
  return {
    userId: session.user.id,
    userName: session.user.name?.trim() || session.user.email,
    userEmail: session.user.email,
    orgId: db.organizationId,
    canSeeAll: db.memberRole === "owner" || db.memberRole === "admin",
    db,
  };
}

/** Raw row; `opener_source_id` is server-only and never leaves this module's callers. */
type TicketRow = {
  id: string;
  reference: number;
  title: string;
  category: string;
  status: TicketStatus;
  linked_type: LinkedKind | null;
  linked_id: string | null;
  linked_listing_name: string | null;
  last_message_preview: string | null;
  last_activity_at: string;
  opened_by_user_id: string | null;
  opened_by_name: string | null;
  unread: boolean;
  handed_off_at: string | null;
  resolved_at: string | null;
  follow_up_of: string | null;
};

// $1 org, $2 viewer user id.
const TICKET_COLUMNS = `
  t.id, t.chatwoot_conversation_id::int AS reference, t.title, t.category, t.status,
  t.linked_type, t.linked_id, lp.name AS linked_listing_name,
  t.last_message_preview, t.last_activity_at::text AS last_activity_at,
  t.opened_by_user_id, COALESCE(NULLIF(trim(u.name), ''), u.email) AS opened_by_name,
  (
    t.opened_by_user_id = $2
    AND t.last_message_sender IN ('agent_bot', 'user')
    AND (r.last_seen_at IS NULL OR r.last_seen_at < t.last_message_at)
  ) AS unread,
  t.handed_off_at::text AS handed_off_at, t.resolved_at::text AS resolved_at, t.follow_up_of
`;

const TICKET_FROM = `
  FROM support_tickets t
  LEFT JOIN "user" u ON u.id = t.opened_by_user_id
  LEFT JOIN support_ticket_reads r ON r.ticket_id = t.id AND r.user_id = $2
  LEFT JOIN properties lp
    ON t.linked_type = 'listing' AND lp.id::text = t.linked_id AND lp.organization_id = t.organization_id
`;

function linkedOf(row: TicketRow): TicketSummary["linked"] {
  if (!row.linked_type || !row.linked_id) return null;
  if (row.linked_type === "booking") {
    return { type: "booking", id: row.linked_id, label: `Booking ${shortBookingRef(row.linked_id)}` };
  }
  return { type: "listing", id: row.linked_id, label: row.linked_listing_name ?? "Listing" };
}

function toSummary(row: TicketRow, viewerId: string): TicketSummary {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    category: row.category,
    status: row.status,
    linked: linkedOf(row),
    lastMessagePreview: row.last_message_preview,
    lastActivityAt: new Date(row.last_activity_at).toISOString(),
    unread: row.unread === true,
    mine: row.opened_by_user_id === viewerId,
    openedBy: row.opened_by_user_id
      ? { id: row.opened_by_user_id, name: row.opened_by_name ?? "Former member" }
      : null,
  };
}

function toDetail(row: TicketRow, viewerId: string): TicketDetail {
  const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
  return {
    ...toSummary(row, viewerId),
    handedOffAt: iso(row.handed_off_at),
    resolvedAt: iso(row.resolved_at),
    followUpOf: row.follow_up_of,
    readOnly: row.opened_by_user_id !== viewerId,
  };
}

/** `($3::bool OR t.opened_by_user_id = $2)`: all tickets for owners/admins, else your own. */
const VISIBLE = `t.organization_id = $1 AND ($3::bool OR t.opened_by_user_id = $2)`;

export const TICKETS_PAGE_SIZE = 25;

export async function listTickets(
  scope: SupportScope,
  opts: { tab: TicketTab; page: number },
): Promise<{
  tickets: TicketSummary[];
  counts: Record<TicketTab, number>;
  hasNextPage: boolean;
  showOpenedBy: boolean;
}> {
  const page = Math.max(1, Math.floor(opts.page) || 1);
  const [rows, counts, members] = await Promise.all([
    scope.db.query<TicketRow>(
      `SELECT ${TICKET_COLUMNS} ${TICKET_FROM}
        WHERE ${VISIBLE} AND t.status = ANY($4::text[])
        ORDER BY t.last_activity_at DESC, t.id
        LIMIT $5 OFFSET $6`,
      [scope.userId, scope.canSeeAll, tabStatuses(opts.tab), TICKETS_PAGE_SIZE + 1, (page - 1) * TICKETS_PAGE_SIZE],
    ),
    scope.db.queryOne<{ open: number; resolved: number; all: number }>(
      `SELECT count(*) FILTER (WHERE t.status <> 'resolved')::int AS open,
              count(*) FILTER (WHERE t.status = 'resolved')::int AS resolved,
              count(*)::int AS all
         FROM support_tickets t WHERE ${VISIBLE}`,
      [scope.userId, scope.canSeeAll],
    ),
    scope.db.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM "member" WHERE "organizationId" = $1`),
  ]);
  return {
    tickets: rows.slice(0, TICKETS_PAGE_SIZE).map((row) => toSummary(row, scope.userId)),
    counts: { open: counts?.open ?? 0, resolved: counts?.resolved ?? 0, all: counts?.all ?? 0 },
    hasNextPage: rows.length > TICKETS_PAGE_SIZE,
    // "Opened by" only means something when more than one person can open tickets.
    showOpenedBy: scope.canSeeAll && (members?.n ?? 0) > 1,
  };
}

/** The panel's home list (your open tickets) and your unread count. */
export async function panelTickets(scope: SupportScope): Promise<{ openTickets: TicketSummary[]; unreadCount: number }> {
  const [rows, unread] = await Promise.all([
    scope.db.query<TicketRow>(
      `SELECT ${TICKET_COLUMNS} ${TICKET_FROM}
        WHERE t.organization_id = $1 AND t.opened_by_user_id = $2 AND t.status <> 'resolved'
        ORDER BY t.last_activity_at DESC
        LIMIT 3`,
      [scope.userId],
    ),
    scope.db.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM support_tickets t
         LEFT JOIN support_ticket_reads r ON r.ticket_id = t.id AND r.user_id = $2
        WHERE t.organization_id = $1 AND t.opened_by_user_id = $2
          AND t.last_message_sender IN ('agent_bot', 'user')
          AND (r.last_seen_at IS NULL OR r.last_seen_at < t.last_message_at)`,
      [scope.userId],
    ),
  ]);
  return { openTickets: rows.map((row) => toSummary(row, scope.userId)), unreadCount: unread?.n ?? 0 };
}

export type TicketAccess = {
  ticket: TicketDetail;
  conversationId: number;
  /** The opener's Chatwoot source_id. Server-only. */
  openerSourceId: string | null;
  canWrite: boolean;
};

/**
 * Load a ticket the session may see, with what the server needs to talk to
 * Chatwoot about it. Null when it doesn't exist, is in another org, or is
 * someone else's and the viewer isn't an owner/admin — indistinguishably.
 */
export async function getTicketAccess(scope: SupportScope, ticketId: string): Promise<TicketAccess | null> {
  if (!isUuid(ticketId)) return null;
  const row = await scope.db.queryOne<TicketRow & { opener_source_id: string | null; conversation_id: number }>(
    `SELECT ${TICKET_COLUMNS}, sc.source_id AS opener_source_id,
            t.chatwoot_conversation_id::int AS conversation_id
       ${TICKET_FROM}
       LEFT JOIN support_contacts sc ON sc.user_id = t.opened_by_user_id
      WHERE ${VISIBLE} AND t.id = $4::uuid`,
    [scope.userId, scope.canSeeAll, ticketId],
  );
  if (!row) return null;
  const ticket = toDetail(row, scope.userId);
  return {
    ticket,
    conversationId: row.conversation_id,
    openerSourceId: row.opener_source_id,
    canWrite: !ticket.readOnly,
  };
}

/** Linkable items for the intake picker, limited to properties the user can read. */
export async function searchLinkables(
  scope: SupportScope,
  kind: LinkedKind,
  search: string,
): Promise<LinkOption[]> {
  const q = search.trim().replace(/^#/, "").toLowerCase().slice(0, 60);
  if (kind === "listing") {
    const rows = await scope.db.query<{ id: string; name: string; city: string | null }>(
      `SELECT p.id::text AS id, p.name, p.city
         FROM properties p
        WHERE p.organization_id = $1 AND ${propertyReadAccessSql("$2")}
          AND ($3 = '' OR lower(p.name) LIKE '%' || $3 || '%')
        ORDER BY p.name
        LIMIT 20`,
      [scope.userId, q],
    );
    return rows.map((r) => ({ type: "listing", id: r.id, label: r.name, detail: r.city ?? "" }));
  }

  // Recent and upcoming bookings first: nearest check-in to today.
  const rows = await scope.db.query<{
    id: string;
    guest_name: string | null;
    check_in_date: string;
    check_out_date: string;
    property_name: string;
  }>(
    `SELECT b.id::text AS id, u.name AS guest_name, b.check_in_date::text AS check_in_date,
            b.check_out_date::text AS check_out_date, p.name AS property_name
       FROM bookings b
       JOIN properties p ON p.id = b.hotel_id
       LEFT JOIN "user" u ON u.id = b.user_id
      WHERE p.organization_id = $1 AND ${propertyReadAccessSql("$2")}
        AND ($3 = '' OR b.id::text LIKE $3 || '%' OR lower(coalesce(u.name, '')) LIKE '%' || $3 || '%')
      ORDER BY abs(b.check_in_date - current_date), b.created_at DESC
      LIMIT 20`,
    [scope.userId, q],
  );
  const dates = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return rows.map((r) => ({
    type: "booking",
    id: r.id,
    label: `Booking ${shortBookingRef(r.id)}`,
    detail: [
      r.guest_name,
      `${dates.format(new Date(r.check_in_date))} – ${dates.format(new Date(r.check_out_date))}`,
      r.property_name,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

/**
 * Verify a linked item belongs to the org and the user can read it. Returns
 * its label and property, or null. Every create re-checks, so a forged id
 * can't attach another org's booking to a ticket.
 */
export async function resolveLinked(
  scope: SupportScope,
  kind: LinkedKind,
  id: string,
): Promise<{ label: string; propertyId: string } | null> {
  if (!isUuid(id)) return null;
  if (kind === "listing") {
    const row = await scope.db.queryOne<{ id: string; name: string }>(
      `SELECT p.id::text AS id, p.name FROM properties p
        WHERE p.id = $3::uuid AND p.organization_id = $1 AND ${propertyReadAccessSql("$2")}`,
      [scope.userId, id],
    );
    return row ? { label: row.name, propertyId: row.id } : null;
  }
  const row = await scope.db.queryOne<{ id: string; property_id: string }>(
    `SELECT b.id::text AS id, p.id::text AS property_id
       FROM bookings b JOIN properties p ON p.id = b.hotel_id
      WHERE b.id = $3::uuid AND p.organization_id = $1 AND ${propertyReadAccessSql("$2")}`,
    [scope.userId, id],
  );
  return row ? { label: `Booking ${shortBookingRef(row.id)}`, propertyId: row.property_id } : null;
}

/** The property a ticket without a linked item is filed under: the user's first. */
export async function defaultPropertyId(scope: SupportScope): Promise<string | null> {
  const row = await scope.db.queryOne<{ id: string }>(
    `SELECT p.id::text AS id FROM properties p
      WHERE p.organization_id = $1 AND ${propertyReadAccessSql("$2")}
      ORDER BY p.name LIMIT 1`,
    [scope.userId],
  );
  return row?.id ?? null;
}

/** A resolved ticket of yours in this org, as the parent of a follow-up. */
export async function resolveFollowUp(scope: SupportScope, ticketId: string): Promise<string | null> {
  if (!isUuid(ticketId)) return null;
  const row = await scope.db.queryOne<{ id: string }>(
    `SELECT id FROM support_tickets
      WHERE organization_id = $1 AND opened_by_user_id = $2 AND id = $3::uuid AND status = 'resolved'`,
    [scope.userId, ticketId],
  );
  return row?.id ?? null;
}
