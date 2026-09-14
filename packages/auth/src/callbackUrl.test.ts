import { describe, expect, test } from "bun:test"
import { resolveCallbackURL } from "./callbackUrl"

const APP = "https://openbookings.co"

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

describe("resolveCallbackURL — refuses anything off-origin", () => {
  // Each of these is a way to leave our site while looking like a path.
  const attacks: Array<[string, string]> = [
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/checkout"],
    ["backslash-relative", "/\\evil.com"],
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
