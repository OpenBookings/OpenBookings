import { getEmailClient, loadTemplate } from "@openbookings/mailing";

const DEFAULT_FROM = "Roy at OpenBookings <noreply@openbookings.co>";
const FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS ?? process.env.MAGIC_LINK_FROM ?? DEFAULT_FROM;

export async function sendMagicLink(
  email: string,
  url: string,
  _firstName?: string
) {
  await getEmailClient()
    .from(FROM_ADDRESS)
    .to(email)
    .subject("Your sign-in link for OpenBookings")
    .html(loadTemplate("magic-link", { magicLinkUrl: url, email }))
    .send();
}
