import { describe, expect, test } from "bun:test";
import { safeReplayUrl, safeRoute } from "./safe-attributes";

describe("safeReplayUrl", () => {
  test("accepts a PostHog replay link", () => {
    const url = "https://eu.posthog.com/project/123/replay/abc-def?t=42";
    expect(safeReplayUrl(url)).toBe(url);
    expect(safeReplayUrl("https://posthog.com/x")).toBe("https://posthog.com/x");
  });

  test("drops links that only look like PostHog", () => {
    for (const bad of [
      "https://evil.example/replay",
      "https://posthog.com.evil.example/replay",
      "https://evilposthog.com/replay",
      "https://posthog.com@evil.example/x",
      "https://user:pw@eu.posthog.com/x",
      "http://eu.posthog.com/x",
      "javascript:alert(1)",
      "https://eu.posthog.com:8443/x",
      "https://eu.posthog.com/" + "x".repeat(500),
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(safeReplayUrl(bad)).toBeNull();
    }
  });
});

describe("safeRoute", () => {
  test("accepts site-relative paths", () => {
    expect(safeRoute("/dashboard/bookings?tab=a")).toBe("/dashboard/bookings?tab=a");
  });
  test("drops anything else", () => {
    for (const bad of ["//evil.example", "/\\evil", "https://evil.example", "dashboard", "/a\nb", "/a\u202eb", "/" + "x".repeat(200), "", null]) {
      expect(safeRoute(bad)).toBeNull();
    }
  });
});
