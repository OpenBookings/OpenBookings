/**
 * Host-facing words for Chatwoot statuses. `snoozed` is internal to the
 * support team and always reads as "With support team".
 */

export type TicketStatus = "pending" | "open" | "snoozed" | "resolved";

export const STATUS_LABELS: Record<TicketStatus, string> = {
  pending: "With assistant",
  open: "With support team",
  snoozed: "With support team",
  resolved: "Resolved",
};

/** Label when the assistant is switched off: nobody waits "with assistant". */
export function statusLabel(status: TicketStatus, assistantEnabled = true): string {
  if (status === "pending" && !assistantEnabled) return STATUS_LABELS.open;
  return STATUS_LABELS[status];
}

export type TicketTab = "open" | "resolved" | "all";

export const TICKET_TABS: { value: TicketTab; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

export function parseTicketTab(value: string | string[] | undefined): TicketTab {
  return value === "resolved" || value === "all" ? value : "open";
}

/** The statuses each tab shows. */
export function tabStatuses(tab: TicketTab): TicketStatus[] {
  if (tab === "open") return ["pending", "open", "snoozed"];
  if (tab === "resolved") return ["resolved"];
  return ["pending", "open", "snoozed", "resolved"];
}
