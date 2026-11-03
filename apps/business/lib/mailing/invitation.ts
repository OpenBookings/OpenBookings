import { escapeHtml, getEmailClient, loadTemplate } from "@openbookings/mailing";
import type { HostInvitationEmail } from "@openbookings/auth/host";
import { roleLabel } from "@openbookings/authz/role-guide";

const DEFAULT_FROM = "Roy at OpenBookings <noreply@openbookings.co>";
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS ?? process.env.MAGIC_LINK_FROM ?? DEFAULT_FROM;
const APP_URL = (process.env.NEXT_PUBLIC_BUSINESS_URL || "https://business.openbookings.co").replace(/\/$/, "");

/** Where an invitation is opened. Signing in first is handled by the proxy. */
export function invitationUrl(invitationId: string, appUrl: string = APP_URL): string {
  return `${appUrl}/invite/${encodeURIComponent(invitationId)}`;
}

const expiry = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/**
 * Subject and body of an invitation. Pure, so it can be tested. The names
 * come from people (the inviter's name, the organisation's name), so they
 * are escaped before going into the HTML slots.
 */
export function renderInvitation(invite: HostInvitationEmail, appUrl: string = APP_URL) {
  const org = escapeHtml(invite.organizationName);
  const inviter = escapeHtml(invite.inviterName);
  const role = escapeHtml(roleLabel(invite.role));
  const subject = `${invite.inviterName} invited you to ${invite.organizationName} on OpenBookings`;
  const html = loadTemplate(
    "account-action",
    {
      subject,
      preheader: `Join ${invite.organizationName} as ${roleLabel(invite.role)}.`,
      eyebrow: "Team invitation",
      headline: `Join ${org}.`,
      body: `${inviter} invited you to join <strong>${org}</strong> on OpenBookings as <strong>${role}</strong>. Sign in with this email address (${escapeHtml(invite.email)}) to accept.`,
      ctaUrl: invitationUrl(invite.invitationId, appUrl),
      ctaLabel: "View invitation →",
      footnote: `The invitation is open until ${expiry.format(invite.expiresAt)}. Not expecting it? Ignore this email and nothing happens.`,
    },
    { htmlSlots: ["headline", "body", "footnote"] },
  );
  return { subject, html };
}

export async function sendInvitationEmail(invite: HostInvitationEmail): Promise<void> {
  const { subject, html } = renderInvitation(invite);
  await getEmailClient().from(FROM_ADDRESS).to(invite.email).subject(subject).html(html).send();
}
