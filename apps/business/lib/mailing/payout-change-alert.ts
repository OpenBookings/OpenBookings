import { getEmailClient } from "@openbookings/mailing"

const DEFAULT_FROM = "OpenBookings Security <noreply@openbookings.co>"
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS ?? DEFAULT_FROM

export type PayoutChange = {
  organisationName: string
  change: "created" | "updated" | "deleted"
  /** Last four digits only. The full account number is never handled here. */
  last4: string | null
  country: string | null
}

const VERB: Record<PayoutChange["change"], string> = {
  created: "was added",
  updated: "was changed",
  deleted: "was removed",
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" })
function countryName(code: string | null): string | null {
  if (!code) return null
  try {
    return countryNames.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

/**
 * Subject and body for the notice sent when a host's payout bank account is
 * added, changed or removed in Stripe. Pure, so it can be tested and previewed.
 *
 * Bank details are changed in the host's own Stripe Dashboard, where
 * OpenBookings cannot prevent a takeover of the host's Stripe login. Telling
 * every owner is the control that is left: a change nobody made gets noticed.
 *
 * Deliberately no sign-in link: a security email that trains people to click
 * through to a login page is the phishing template.
 */
export function renderPayoutChangeAlert(
  change: PayoutChange,
  at: Date = new Date()
): { subject: string; text: string; html: string } {
  const subject = `The payout bank account for ${change.organisationName} ${VERB[change.change]}`

  const account = [
    change.last4 ? `ending in ${change.last4}` : null,
    countryName(change.country),
  ]
    .filter(Boolean)
    .join(", ")
  const when = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(at)

  const lines = [
    `The bank account that ${change.organisationName}'s payouts are sent to ${VERB[change.change]} in Stripe.`,
    account ? `Account: ${account}` : null,
    `When: ${when}`,
    "",
    "If you or a colleague did this, there is nothing to do.",
    "",
    "If this was not you: go to dashboard.stripe.com directly (type the address, do not follow a link), check the bank account under Settings, change your Stripe password and turn on two-step authentication. Then reply to this email so we can help.",
  ].filter((line): line is string => line !== null)

  const text = lines.join("\n")
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:22px;color:#111111;">${lines
    .map((line) => (line === "" ? "<br/>" : `<p style="margin:0 0 8px;">${escapeHtml(line)}</p>`))
    .join("")}</div>`

  return { subject, text, html }
}

/** Sent to every owner of the organisation. Never throws for a failed send. */
export async function sendPayoutChangeAlert(
  ownerEmails: string[],
  change: PayoutChange
): Promise<void> {
  const { subject, html } = renderPayoutChangeAlert(change)
  await Promise.allSettled(
    [...new Set(ownerEmails)].map((to) =>
      getEmailClient().from(FROM_ADDRESS).to(to).subject(subject).html(html).send()
    )
  )
}
