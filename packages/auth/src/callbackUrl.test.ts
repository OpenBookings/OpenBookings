import { describe, expect, test } from "bun:test"
import { resolveCallbackPath, resolveCallbackURL } from "./callbackUrl"

const APP = "https://openbookings.co"
const BUSINESS = "https://business.openbookings.co"

describe("resolveCallbackURL — accepts our own paths", () => {
  test("a plain path resolves against our origin", () => {
    expect(resolveCallbackURL("/checkout", APP)).toBe("https://openbookings.co/checkout")
  })

  test("a path keeps its query and fragment", () => {
    expect(resolveCallbackURL("/checkout?step=pay#card", APP)).toBe(
      "https://openbookings.co/checkout?step=pay#card",
    )
  })

  test("the root path is fine", () => {
    expect(resolveCallbackURL("/", APP)).toBe("https://openbookings.co/")
  })

  test("a localhost deployment resolves against itself", () => {
    expect(resolveCallbackURL("/checkout", "http://localhost:3002")).toBe(
      "http://localhost:3002/checkout",
    )
  })
})

// The two apps are separate origins, so each is foreign to the other. This is
// precisely what the old guest-only default got wrong: called from the business
// app without an explicit origin, "/dashboard" became a working magic link to
// the consumer site.
describe("resolveCallbackURL — the business app is its own origin", () => {
  test("a path resolves against the business origin", () => {
    expect(resolveCallbackURL("/dashboard", BUSINESS)).toBe(
      "https://business.openbookings.co/dashboard",
    )
  })

  test("the business app in local development resolves against itself", () => {
    expect(resolveCallbackURL("/dashboard", "http://business.localhost:3001")).toBe(
      "http://business.localhost:3001/dashboard",
    )
  })

  test("the guest app's own URL is refused on the business origin", () => {
    expect(resolveCallbackURL(`${APP}/dashboard`, BUSINESS)).toBe(BUSINESS)
  })

  test("the business app's own URL is refused on the guest origin", () => {
    expect(resolveCallbackURL(`${BUSINESS}/dashboard`, APP)).toBe(APP)
  })
})

// The guard below is shared with resolveCallbackPath, so this table covers the
// rejection rules for both exports and is not replayed there.
describe("resolveCallbackURL — refuses anything off-origin", () => {
  // Each of these is a way to leave our site while looking like a path.
  const attacks: Array<[string, string]> = [
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/checkout"],
    ["backslash-relative", "/\\evil.com"],
    ["backslash then slash", "/\\/evil.com"],
    ["double backslash", "\\\\evil.com"],
    ["absolute https", "https://evil.com"],
    ["absolute http", "http://evil.com"],
    // Built rather than written literally: an inline "javascript:" string
    // trips eslint's no-script-url rule even inside a test asserting it
    // is refused.
    ["scheme-only", ["java", "script:alert(1)"].join("")],
    ["data URI", "data:text/html,<script>alert(1)</script>"],
    ["userinfo confusion", "https://openbookings.co@evil.com"],
    ["subdomain confusion", "https://openbookings.co.evil.com"],
    ["prefix confusion", "https://openbookings.com"],
    ["no leading slash", "evil.com"],
    ["newline injection", "/checkout\nLocation: https://evil.com"],
    ["NUL byte", "/checkout\u0000"],
    ["carriage return", "/checkout\r\nSet-Cookie: a=b"],
    ["embedded tab", "/\tevil.com"],
  ]

  for (const [name, value] of attacks) {
    test(`${name}: ${JSON.stringify(value)} falls back to the app root`, () => {
      expect(resolveCallbackURL(value, APP)).toBe(APP)
    })
  }

  test("an over-long value is refused rather than parsed", () => {
    expect(resolveCallbackURL("/" + "a".repeat(600), APP)).toBe(APP)
  })
})

describe("resolveCallbackURL — refuses non-strings", () => {
  for (const value of [undefined, null, 42, {}, [], true]) {
    test(`${JSON.stringify(value) ?? "undefined"} falls back to the app root`, () => {
      expect(resolveCallbackURL(value, APP)).toBe(APP)
    })
  }
})

describe("resolveCallbackURL — a misconfigured origin is a deploy bug", () => {
  for (const appUrl of ["", "not-a-url"]) {
    test(`${JSON.stringify(appUrl)} throws rather than yielding a junk link`, () => {
      expect(() => resolveCallbackURL("/checkout", appUrl)).toThrow()
    })
  }
})

// Shares the guard tested above, so this covers only what differs: the return
// shape and the caller-supplied fallback.
describe("resolveCallbackPath", () => {
  const FALLBACK = "/onboarding"

  test("returns a path, not an absolute URL, and keeps query and hash", () => {
    expect(resolveCallbackPath("/dashboard", FALLBACK)).toBe("/dashboard")
    expect(resolveCallbackPath("/dashboard?tab=a#b", FALLBACK)).toBe("/dashboard?tab=a#b")
  })

  test("falls back when there is no target", () => {
    expect(resolveCallbackPath(undefined, FALLBACK)).toBe(FALLBACK)
    expect(resolveCallbackPath("", FALLBACK)).toBe(FALLBACK)
  })

  test("off-origin targets fall back to the caller's path", () => {
    expect(resolveCallbackPath("//evil.example", FALLBACK)).toBe(FALLBACK)
    expect(resolveCallbackPath("https://evil.example", FALLBACK)).toBe(FALLBACK)
  })

  // Tighter than the apps/business helper this replaces, which stripped the
  // tab and returned "/evil.example".
  test("an embedded tab is refused rather than stripped", () => {
    expect(resolveCallbackPath("/\tevil.example", FALLBACK)).toBe(FALLBACK)
  })

  test("an encoded slash is a literal path segment, not an origin change", () => {
    expect(resolveCallbackPath("/%2f%2fevil.example", FALLBACK)).toBe("/%2f%2fevil.example")
  })
})
