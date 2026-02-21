import { postmarkClient } from "@/lib/mailing/postmark"

const FROM_ADDRESS = "Roy at OpenBookings <noreply@openbookings.co>"

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
