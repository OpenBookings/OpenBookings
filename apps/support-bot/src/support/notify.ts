import { claimSupportReplyNotification } from "@openbookings/db";
import { getEmailClient, sender } from "@openbookings/mailing";
import { trackMail } from "@openbookings/mailing/tracking";
import { env } from "../env";
import type { SupportReplyNotifyPayload } from "../tasks";
import { trace } from "../trace";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The reply-notification email. Deliberately carries **no message content**
 * and no ticket title (the title can quote the host's own message): support
 * conversations hold guest personal data and stay inside the signed-in app.
 * Only the ticket reference and a link.
 */
export function renderSupportReplyEmail(input: {
  name: string | null;
  reference: number;
  url: string;
}): { subject: string; text: string; html: string } {
  const subject = `New reply on your support ticket #${input.reference}`;
  const greeting = input.name?.trim() ? `Hi ${input.name.trim().split(/\s+/)[0]},` : "Hi,";
  const lines = [
    greeting,
    "",
    `There is a new reply on your OpenBookings support ticket #${input.reference}.`,
    "Open the ticket in OpenBookings Business to read it and answer:",
    input.url,
    "",
    "You get at most one of these emails per ticket per hour. Answer in OpenBookings Business so your reply lands on the ticket.",
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:22px;color:#111111;">${lines
    .map((line) => {
      if (line === "") return "<br/>";
      if (line === input.url) {
        const href = escapeHtml(input.url);
        return `<p style="margin:0 0 8px;"><a href="${href}" style="color:#3e63dd;">Open ticket #${input.reference}</a></p>`;
      }
      return `<p style="margin:0 0 8px;">${escapeHtml(line)}</p>`;
    })
    .join("")}</div>`;
  return { subject, text, html };
}

/**
 * Task handler, run ~10 minutes after a reply. The DB claim decides whether
 * to send (unseen, not emailed in the last hour, still a member) and stamps
 * the send in the same statement, so retries and parallel workers can't send
 * twice.
 */
export async function sendSupportReplyNotification(
  payload: SupportReplyNotifyPayload,
  deps: {
    track?: typeof trackMail;
    claim?: typeof claimSupportReplyNotification;
    getClient?: typeof getEmailClient;
  } = {},
): Promise<void> {
  const track = deps.track ?? trackMail;
  const claimNotification = deps.claim ?? claimSupportReplyNotification;
  const getClient = deps.getClient ?? getEmailClient;
  const messageAt = new Date(payload.messageAt);
  if (Number.isNaN(messageAt.getTime())) return;
  const claim = await claimNotification(payload.conversationId, messageAt);
  if (!claim) {
    trace("notify", "nothing to send", { conversationId: payload.conversationId });
    return;
  }
  const url = `${env.businessAppUrl}/support?ticket=${encodeURIComponent(claim.ticket_id)}`;
  const { subject, html, text } = renderSupportReplyEmail({
    name: claim.name,
    reference: claim.conversation_id,
    url,
  });
  try {
    const tracked = await track({ kind: "support_reply", to: claim.email, html });
    await getClient()
      .from(sender("support"))
      .to(claim.email)
      .subject(subject)
      .html(tracked.html)
      .text(text)
      .send();
    await tracked.onSent();
    trace("notify", "reply email sent", { conversationId: payload.conversationId });
  } catch (err) {
    // The claim is already stamped, so a retry would be refused anyway; the
    // in-app dot still shows the reply.
    console.error("[notify] reply email for conversation %s failed:", payload.conversationId, err);
  }
}
