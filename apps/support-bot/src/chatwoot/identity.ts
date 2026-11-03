/**
 * Whether the email on a Chatwoot contact is one we can treat as proof of who
 * is typing.
 *
 * The webhook body carries an email for any contact, but it does not say how
 * that email got there. On a live-chat inbox it may be whatever the visitor
 * typed into the pre-chat form; on an email inbox it is the From header. Either
 * way a stranger can claim another guest's address, and the booking tools
 * would then list that guest's stays and payment states.
 *
 * Chatwoot's defence is identity validation: the site signs the visitor's
 * identifier with HMAC, and an inbox set to *mandatory* refuses `setUser`
 * calls without a valid hash. The webhook does not report that setting, so it
 * is configuration here (CHATWOOT_VERIFIED_INBOX_IDS: the inboxes where an
 * admin has turned that on). An email counts as verified only when BOTH hold:
 *
 *  - the conversation is in one of those inboxes, and
 *  - the contact has an `identifier`, which in such an inbox can only have been
 *    set by a correctly signed `setUser` from our server.
 *
 * Empty by default, so nothing is verified until someone enables it
 * deliberately (fail closed).
 */
export function isVerifiedGuestIdentity(i: {
  guestEmail: string | null;
  inboxId: number | undefined;
  contactIdentifier: string | null | undefined;
  verifiedInboxIds: readonly number[];
}): boolean {
  if (!i.guestEmail) return false;
  if (typeof i.inboxId !== "number" || !i.verifiedInboxIds.includes(i.inboxId)) return false;
  return Boolean(i.contactIdentifier?.trim());
}

/** Parses a comma-separated list of positive inbox ids; throws on anything else. */
export function parseInboxIds(raw: string | undefined, name: string): number[] {
  const text = raw?.trim();
  if (!text) return [];
  return text.split(",").map((part) => {
    const id = Number(part.trim());
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`${name} must be a comma-separated list of positive integers, got "${text}"`);
    }
    return id;
  });
}
