import { getEmailClient, loadTemplate } from "@openbookings/mailing";

const DEFAULT_FROM = "Roy at OpenBookings <noreply@openbookings.co>";
const FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS ?? process.env.MAGIC_LINK_FROM ?? DEFAULT_FROM;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://business.openbookings.co";

const PREVIEW_MAX_LENGTH = 200;

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendNewMessageEmail(
  email: string,
  params: { threadId: string; body: string },
) {
  const threadUrl = `${APP_URL}/dashboard/bookings/messages?id=${encodeURIComponent(params.threadId)}`;
  const truncated =
    params.body.length > PREVIEW_MAX_LENGTH
      ? `${params.body.slice(0, PREVIEW_MAX_LENGTH)}…`
      : params.body;
  const preview = escapeHtml(truncated);

  await getEmailClient()
    .from(FROM_ADDRESS)
    .to(email)
    .subject("New message on OpenBookings")
    .html(loadTemplate("new-message", { threadUrl, preview }))
    .send();
}
