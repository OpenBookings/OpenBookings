/**
 * Who is typing in a guest conversation, as far as we can prove it.
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
 * admin has turned that on).
 *
 * The HMAC covers the identifier only, not the email on the contact: a
 * visitor signed in as themselves can still set the contact's email to
 * someone else's. So the contact email is never trusted. In a verified inbox
 * the identifier MUST be the guest's OpenBookings user id, and the email the
 * tools use is that user's own account email, read from our database. The
 * identity is verified only when:
 *
 *  - the conversation is in one of those inboxes, and
 *  - the contact has an identifier, and
 *  - that identifier is the id of a guest (private) account with a verified
 *    email.
 *
 * Anything else falls back to the contact's email as an unverified claim.
 * The inbox list is empty by default, so nothing is verified until someone
 * enables it deliberately (fail closed).
 */
export async function resolveGuestIdentity(i: {
  /** The email on the Chatwoot contact: a claim, never proof. */
  claimedEmail: string | null;
  inboxId: number | undefined;
  contactIdentifier: string | null | undefined;
  verifiedInboxIds: readonly number[];
  /** The verified account email of the guest user with this id, or null. */
  findGuestEmailByUserId: (userId: string) => Promise<string | null>;
}): Promise<{ guestEmail: string | null; guestEmailVerified: boolean }> {
  const unverified = { guestEmail: i.claimedEmail, guestEmailVerified: false };
  if (typeof i.inboxId !== "number" || !i.verifiedInboxIds.includes(i.inboxId)) return unverified;
  const userId = i.contactIdentifier?.trim();
  if (!userId) return unverified;
  const accountEmail = (await i.findGuestEmailByUserId(userId))?.trim().toLowerCase();
  if (!accountEmail) return unverified;
  return { guestEmail: accountEmail, guestEmailVerified: true };
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
