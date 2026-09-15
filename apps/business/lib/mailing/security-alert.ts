import { getEmailClient } from "@openbookings/mailing"
import type { SecurityAlert } from "@openbookings/auth/host"

const DEFAULT_FROM = "OpenBookings Security <noreply@openbookings.co>"
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS ?? DEFAULT_FROM

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

/**
 * New-device notification (task 17): sent to every org owner, not just the
 * signing-in user — a compromised account holder shouldn't be the only one
 * who knows about a new device.
 */
export async function sendSecurityAlert(alert: SecurityAlert): Promise<void> {
  const recipients = new Set([alert.userEmail, ...alert.ownerEmails])
  const details = [
    `Account: ${escapeHtml(alert.userEmail)}`,
    alert.ip ? `IP address: ${escapeHtml(alert.ip)}` : null,
    alert.userAgent ? `Browser: ${escapeHtml(alert.userAgent)}` : null,
    `Time: ${new Date().toUTCString()}`,
  ].filter(Boolean)

  const html = `
    <p>A sign-in to the OpenBookings business portal just happened from a device we haven't seen before.</p>
    <p>${details.join("<br/>")}</p>
    <p>If this was you or a colleague, no action is needed.</p>
    <p>If you don't recognise this sign-in, open
    <a href="https://business.openbookings.co/account/security">Account &rarr; Security</a>
    and revoke the session, then contact support@openbookings.co.</p>
  `

  await Promise.allSettled(
    [...recipients].map((to) =>
      getEmailClient()
        .from(FROM_ADDRESS)
        .to(to)
        .subject("New device signed in to your OpenBookings business account")
        .html(html)
        .send()
    )
  )
}
