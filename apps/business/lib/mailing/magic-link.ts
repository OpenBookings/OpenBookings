import { getEmailClient, loadTemplate, sender } from "@openbookings/mailing";

export async function sendMagicLink(
  email: string,
  url: string,
  _firstName?: string
) {
  await getEmailClient()
    .from(sender("magic"))
    .to(email)
    .subject("Your sign-in link for OpenBookings")
    .html(loadTemplate("magic-link", { magicLinkUrl: url, email }))
    .send();
}
