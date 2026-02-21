import { postmarkClient } from "@/lib/mailing/postmark"

const DEFAULT_FROM = "Roy at OpenBookings <noreply@openbookings.co>"
const FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS ?? process.env.MAGIC_LINK_FROM ?? DEFAULT_FROM
if (!process.env.EMAIL_FROM_ADDRESS && !process.env.MAGIC_LINK_FROM) {
  console.warn(
    "EMAIL_FROM_ADDRESS (or MAGIC_LINK_FROM) is not set; using default sender. Set it to avoid accidental sender mismatch."
  )
}

export async function sendMagicLink(email: string, url: string, _firstName?: string) {
  await postmarkClient.sendEmail({
    From: FROM_ADDRESS,
    To: email,
    Subject: "Your OpenBookings login link",
    HtmlBody: `<strong>Sign in to OpenBookings</strong><p>Use this link to sign in:</p><p><a href="${url}">${url}</a></p><p>This link expires in a few minutes. If you didn't request it, you can ignore this email.</p>`,
    TextBody: `Sign in to OpenBookings\n\nUse this link to sign in:\n${url}\n\nThis link expires in a few minutes. If you didn't request it, you can ignore this email.`,
    MessageStream: "outbound",
  })
}
