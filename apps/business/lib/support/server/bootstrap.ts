import { readAuthEnv } from "@openbookings/auth/env";
import { supportFlags } from "@openbookings/support";
import { getServerSession } from "@/lib/auth";
import type { SupportBootstrap } from "../types";
import { inboxHours, pubsubTokenFor } from "./service";
import { panelTickets, supportScope } from "./tickets";

/** Host support is switched on for this deployment (SUPPORT_CHAT_ENABLED). */
export function supportChatEnabled(): boolean {
  return supportFlags.chatEnabled;
}

/** The session's support scope, or null when support is off or there's no verified org. */
export async function currentSupportScope() {
  if (!supportChatEnabled()) return null;
  return supportScope(await getServerSession());
}

/** `https://chat.example` → `wss://chat.example/cable`. */
export function cableUrl(base: string | undefined): string | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/cable";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * What the dashboard layout hands the support panel. Null when support is
 * off or the session has no verified org: the panel then never mounts and
 * the sidebar keeps its plain Support link.
 */
export async function loadSupportBootstrap(): Promise<SupportBootstrap | null> {
  const scope = await currentSupportScope();
  if (!scope) return null;
  try {
    const [panel, pubsubToken, hours] = await Promise.all([
      panelTickets(scope),
      pubsubTokenFor(scope.userId),
      inboxHours(),
    ]);
    let appOrigin: string | null = null;
    try {
      appOrigin = new URL(readAuthEnv().AUTH_BASE_URL).origin;
    } catch {}
    return {
      assistantEnabled: supportFlags.assistantEnabled,
      websocketUrl: cableUrl(process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL),
      pubsubToken,
      hours,
      openTickets: panel.openTickets,
      unreadCount: panel.unreadCount,
      appOrigin,
    };
  } catch (err) {
    // A support outage must not take the dashboard down with it.
    console.error("[support] bootstrap failed:", err);
    return null;
  }
}
