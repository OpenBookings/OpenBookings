/**
 * Who each OpenBookings email comes from. Every send picks a role; the name
 * and mailbox for that role live here and nowhere else.
 *
 * Replies to every mailbox are read, so none of them says "do not reply".
 * `EMAIL_DOMAIN` swaps the domain (for a self-hosted install or a test
 * domain); the names stay.
 */
const SENDERS = {
  /** Sign-in links. */
  magic: { name: "OB Magic", mailbox: "magic" },
  /** Account safety: email changes, passkeys, new sign-ins, payout changes, account deletion. */
  security: { name: "OpenBookings Security", mailbox: "security" },
  /** Stays: confirmations, cancellations, refunds, and the host's reservation notices. */
  bookings: { name: "OpenBookings Bookings", mailbox: "bookings" },
  /** The personal ones: review requests and replies, team invitations. */
  roy: { name: "Roy at OpenBookings", mailbox: "roy" },
  /** Commission invoices and credit notes. */
  billing: { name: "OpenBookings Billing", mailbox: "billing" },
  /** Replies on host support tickets. */
  support: { name: "OpenBookings Support", mailbox: "support" },
  /** Internal reports nobody outside OpenBookings sees. */
  noreply: { name: "no-reply", mailbox: "noreply" },
} as const;

export type SenderRole = keyof typeof SENDERS;

const DEFAULT_DOMAIN = "openbookings.co";

/** The `From` header for a role, e.g. `OB Magic <magic@openbookings.co>`. */
export function sender(role: SenderRole): string {
  const { name, mailbox } = SENDERS[role];
  const domain = process.env.EMAIL_DOMAIN?.trim() || DEFAULT_DOMAIN;
  return `${name} <${mailbox}@${domain}>`;
}
