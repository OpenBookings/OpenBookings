import { getEmailClient, loadTemplate } from "@openbookings/mailing"
import type { SecurityAlert, SignInLocation } from "@openbookings/auth/host"
import { describeDevice } from "@/lib/device"

const DEFAULT_FROM = "OpenBookings Security <noreply@openbookings.co>"
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS ?? DEFAULT_FROM
const SECURITY_URL = "https://business.openbookings.co/account/security"

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif"
const MONO = "'Nimbus Mono PS','Courier New',monospace"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" })

function countryName(code: string): string {
  if (code === "T1") return "Tor network"
  try {
    return countryNames.of(code) ?? code
  } catch {
    return code
  }
}

/** "Amsterdam, Netherlands" — region only when there's no city to anchor it. */
export function describeLocation(location: SignInLocation | null): string | null {
  if (!location) return null
  const place = location.city ?? location.region
  const country = location.countryCode ? countryName(location.countryCode) : null
  return [place, country].filter(Boolean).join(", ") || null
}

/**
 * Local time at the sign-in location when Cloudflare gave us a timezone
 * (with its zone abbreviation, so it's never ambiguous), UTC otherwise.
 */
export function describeTime(at: Date, timezone: string | null): string {
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(at)
  if (timezone) {
    try {
      return format(timezone)
    } catch {
      // Unknown zone name: fall through to UTC.
    }
  }
  return format("UTC")
}

function detailRow(label: string, value: string, note?: string | null): string {
  const noteHtml = note
    ? `<br/><span style="font-family:${MONO};font-size:11px;color:#666666;">${escapeHtml(note)}</span>`
    : ""
  return `<tr>
    <td class="ob-detail-label" style="padding:14px 12px 14px 0;width:96px;vertical-align:top;text-align:left;font-family:${SANS};font-size:10px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:#555555;line-height:20px;">${escapeHtml(label)}</td>
    <td style="padding:14px 0;vertical-align:top;text-align:left;font-family:${SANS};font-size:14px;color:#DDDDDD;line-height:20px;">${escapeHtml(value)}${noteHtml}</td>
  </tr>`
}

const divider = `<tr><td colspan="2" style="height:1px;line-height:1px;font-size:0;background-color:rgba(255,255,255,0.06);">&nbsp;</td></tr>`

/** Subject and body for one alert; pure, so it can be previewed and tested. */
export function renderSecurityAlert(
  alert: SecurityAlert,
  at: Date = new Date()
): { subject: string; html: string } {
  const device = describeDevice(alert.userAgent)
  const location = describeLocation(alert.location)
  const time = describeTime(at, alert.location?.timezone ?? null)

  const rows = [
    detailRow("Account", alert.userEmail),
    detailRow("Device", device),
    location
      ? detailRow("Location", location, alert.ip ? `IP ${alert.ip}` : null)
      : alert.ip
        ? detailRow("IP address", alert.ip)
        : null,
    detailRow("Time", time),
  ].filter((row): row is string => row !== null)

  const html = loadTemplate("security-alert", {
    preheader: escapeHtml([device, location].filter(Boolean).join(" · ")),
    detailRows: rows.join(divider),
    securityUrl: SECURITY_URL,
  })

  const subject = location
    ? `New sign-in from ${device} in ${location}`
    : `New sign-in from ${device}`

  return { subject, html }
}

/**
 * New-device notification (task 17): sent to every org owner, not just the
 * signing-in user — a compromised account holder shouldn't be the only one
 * who knows about a new device.
 */
export async function sendSecurityAlert(alert: SecurityAlert): Promise<void> {
  const recipients = new Set([alert.userEmail, ...alert.ownerEmails])
  const { subject, html } = renderSecurityAlert(alert)

  await Promise.allSettled(
    [...recipients].map((to) =>
      getEmailClient().from(FROM_ADDRESS).to(to).subject(subject).html(html).send()
    )
  )
}
