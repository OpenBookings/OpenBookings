/**
 * The actions that ask for a reason and a step-up and are audited first
 * (./dangerous.ts). Kept free of imports so the confirm dialog, a client
 * component, can read the labels.
 *
 * Not dangerous, no dialog: refund previews, what an actor may do
 * (allowedFor), and every read.
 */
export const DANGEROUS_ACTIONS = {
  "booking.cancel_rooms": { label: "Cancel rooms" },
  "booking.goodwill_refund": { label: "Goodwill refund" },
  "booking.retry_refunds": { label: "Retry refunds" },
  "booking.mark_no_show": { label: "Mark as no-show" },
  "booking.early_departure": { label: "Record early departure" },
  "booking.force_status": { label: "Force booking status" },
  "booking.force_uncancel": { label: "Force un-cancel rooms" },
  "booking.force_cancel": { label: "Force cancel rooms" },
  "refund.force_delete": { label: "Delete refund row" },
  "refund.force_status": { label: "Force refund status" },
  "booking.force_clear_markers": { label: "Clear booking markers" },
  "payment_flag.resolve": { label: "Resolve flagged payment" },
  "invoices.run": { label: "Run commission invoices" },
  // Removing a reported item upholds its reports too: there is no separate action for that.
  "review.remove": { label: "Remove review or reply" },
  "security.enrol": { label: "Add a passkey or authenticator app" },
} as const satisfies Record<string, { label: string }>;

export type DangerousAction = keyof typeof DANGEROUS_ACTIONS;

export const isDangerousAction = (value: unknown): value is DangerousAction =>
  typeof value === "string" && Object.hasOwn(DANGEROUS_ACTIONS, value);

/** What the confirm dialog hands a dangerous server action. */
export type Confirmation = { reason: string; stepUpToken: string };

/** A dangerous server action's answer: its own result, or a refusal to show as it is. */
export type DangerousResult<T> = { ok: true; value: T } | { ok: false; message: string };
