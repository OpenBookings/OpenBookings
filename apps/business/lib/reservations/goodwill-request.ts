/**
 * A host's request for a goodwill refund. Hosts don't issue goodwill refunds
 * themselves (owner decision 2026-11-20): they ask support, and OpenBookings
 * staff issue it from the admin app. With support chat on, the text below
 * prefills a new ticket; with it off, the same text goes into an email.
 */

export const SUPPORT_EMAIL = "support@openbookings.co";

export type GoodwillRequest = {
  /** The booking reference the host sees ("0A1B2C3D"). */
  reference: string;
  /** What the host proposes to refund, in euros; null when they leave it to us. */
  amount: number | null;
  reason: string;
};

const euros = new Intl.NumberFormat("en-NL", { style: "currency", currency: "EUR" });

export function goodwillRequestSubject(reference: string): string {
  return `Goodwill refund request for booking ${reference}`;
}

/** The message: booking, proposed amount and reason, one per line. */
export function goodwillRequestText({ reference, amount, reason }: GoodwillRequest): string {
  return [
    "Please issue a goodwill refund to the guest.",
    "",
    `Booking: ${reference}`,
    `Amount: ${amount === null ? "please advise" : euros.format(amount)}`,
    `Reason: ${reason.trim() || "(please add)"}`,
  ].join("\n");
}

/** A mailto: link to support with the same subject and text, for when support chat is off. */
export function goodwillRequestMailto(request: GoodwillRequest): string {
  const subject = encodeURIComponent(goodwillRequestSubject(request.reference));
  const body = encodeURIComponent(goodwillRequestText(request));
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

/**
 * The amount the host typed, if it's a usable one: more than zero and no more
 * than is left to refund. Empty is allowed (null): support works it out.
 * Returns undefined for anything else.
 */
export function parseProposedAmount(text: string, left: number): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0 || value > left) return undefined;
  return Math.round(value * 100) / 100;
}
