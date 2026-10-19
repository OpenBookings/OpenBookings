"use server";

import { checkRateLimit } from "@/lib/rateLimit";
import type { LinkedKind } from "./categories";
import { currentSupportScope } from "./server/bootstrap";
import {
  loadTicket,
  markSeen,
  pubsubTokenFor,
  requestPerson,
  resolveTicket,
  setTyping,
  SupportError,
} from "./server/service";
import { panelTickets, searchLinkables, type SupportScope } from "./server/tickets";
import type { ActionResult, LinkOption, TicketSummary, TicketWithMessages } from "./types";

/**
 * The support panel's server actions. Each resolves the session's support
 * scope (org from the session, membership re-checked) and hands off to the
 * service, which authorizes against the ticket before calling Chatwoot.
 * Nothing here trusts an id from the client beyond looking it up in scope.
 */

const GENERIC_ERROR = "Something went wrong. Please try again.";

async function run<T>(
  fn: (scope: SupportScope) => Promise<T>,
  limit?: { key: string; max: number; windowMs: number },
): Promise<ActionResult<T>> {
  const scope = await currentSupportScope();
  if (!scope) return { ok: false, error: "Support isn't available right now." };
  if (limit) {
    const check = checkRateLimit(`${limit.key}:${scope.userId}`, limit.max, limit.windowMs);
    if (!check.allowed) return { ok: false, error: "You're going a bit fast. Please wait a moment." };
  }
  try {
    const data = await fn(scope);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof SupportError) return { ok: false, error: err.message };
    console.error("[support] action failed:", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function loadTicketAction(ticketId: string): Promise<ActionResult<TicketWithMessages>> {
  return run((scope) => loadTicket(scope, ticketId), { key: "support-load", max: 120, windowMs: 60_000 });
}

export async function refreshPanelAction(): Promise<
  ActionResult<{ openTickets: TicketSummary[]; unreadCount: number; pubsubToken: string | null }>
> {
  return run(async (scope) => ({
    ...(await panelTickets(scope)),
    pubsubToken: await pubsubTokenFor(scope.userId),
  }));
}

export async function markSeenAction(ticketId: string): Promise<ActionResult<undefined>> {
  return run(async (scope) => {
    await markSeen(scope, ticketId);
    return undefined;
  });
}

export async function setTypingAction(ticketId: string, on: boolean): Promise<ActionResult<undefined>> {
  return run(
    async (scope) => {
      await setTyping(scope, ticketId, on);
      return undefined;
    },
    { key: "support-typing", max: 40, windowMs: 60_000 },
  );
}

export async function resolveTicketAction(ticketId: string): Promise<ActionResult<undefined>> {
  return run(async (scope) => {
    await resolveTicket(scope, ticketId);
    return undefined;
  });
}

export async function requestPersonAction(
  ticketId: string,
  reason: "asked" | "not_answered",
): Promise<ActionResult<undefined>> {
  return run(
    async (scope) => {
      await requestPerson(scope, ticketId, reason === "not_answered" ? "not_answered" : "asked");
      return undefined;
    },
    { key: "support-handoff", max: 10, windowMs: 60_000 },
  );
}

export async function searchLinkablesAction(kind: LinkedKind, query: string): Promise<ActionResult<LinkOption[]>> {
  if (kind !== "booking" && kind !== "listing") return { ok: false, error: GENERIC_ERROR };
  return run((scope) => searchLinkables(scope, kind, String(query ?? "")), {
    key: "support-search",
    max: 60,
    windowMs: 60_000,
  });
}
