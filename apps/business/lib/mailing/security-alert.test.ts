import { describe, expect, test } from "bun:test"
import type { SecurityAlert } from "@openbookings/auth/host"
import { describeLocation, describeTime, renderSecurityAlert } from "./security-alert"

const at = new Date("2026-09-29T14:03:00Z")

const alert: SecurityAlert = {
  event: "new-device-sign-in",
  userId: "u1",
  userEmail: "anna@hotel.nl",
  ip: "203.0.113.7",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  location: {
    city: "Amsterdam",
    region: "North Holland",
    countryCode: "NL",
    timezone: "Europe/Amsterdam",
  },
  ownerEmails: ["owner@hotel.nl"],
}

describe("describeLocation", () => {
  test("city and country name", () => {
    expect(describeLocation(alert.location)).toBe("Amsterdam, Netherlands")
  })

  test("falls back to region, then country alone", () => {
    const base = { city: null, region: null, countryCode: "DE", timezone: null }
    expect(describeLocation({ ...base, region: "Bavaria" })).toBe("Bavaria, Germany")
    expect(describeLocation(base)).toBe("Germany")
  })

  test("names Tor exits and handles no location", () => {
    expect(
      describeLocation({ city: null, region: null, countryCode: "T1", timezone: null })
    ).toBe("Tor network")
    expect(describeLocation(null)).toBeNull()
  })
})

describe("describeTime", () => {
  test("uses the sign-in location's timezone when known", () => {
    expect(describeTime(at, "Europe/Amsterdam")).toContain("16:03")
  })

  test("falls back to UTC for a missing or bogus zone", () => {
    expect(describeTime(at, null)).toContain("14:03 UTC")
    expect(describeTime(at, "Not/AZone")).toContain("14:03 UTC")
  })
})

describe("renderSecurityAlert", () => {
  test("summarises the device and never dumps the raw user-agent", () => {
    const { subject, html } = renderSecurityAlert(alert, at)
    expect(subject).toBe("New sign-in from Chrome on macOS in Amsterdam, Netherlands")
    expect(html).toContain("Chrome on macOS")
    expect(html).toContain("IP 203.0.113.7")
    expect(html).not.toContain("AppleWebKit")
    expect(html).not.toContain("{{")
  })

  test("escapes header-derived values", () => {
    const { html } = renderSecurityAlert(
      { ...alert, location: { ...alert.location!, city: "<script>x</script>" } },
      at
    )
    expect(html).not.toContain("<script>x")
    expect(html).toContain("&lt;script&gt;")
  })

  test("shows a bare IP row when there's no location", () => {
    const { subject, html } = renderSecurityAlert({ ...alert, location: null }, at)
    expect(subject).toBe("New sign-in from Chrome on macOS")
    expect(html).toContain("IP address")
    expect(html).not.toContain("Location")
  })
})
