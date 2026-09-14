import { describe, expect, it } from "bun:test";
import { safeRedirectPath } from "./safe-redirect";

const FALLBACK = "/onboarding";

describe("safeRedirectPath", () => {
  it("keeps same-origin paths, including query and hash", () => {
    expect(safeRedirectPath("/dashboard", FALLBACK)).toBe("/dashboard");
    expect(safeRedirectPath("/dashboard?tab=a#b", FALLBACK)).toBe("/dashboard?tab=a#b");
  });

  it("falls back when there is no target", () => {
    expect(safeRedirectPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects absolute URLs to another origin", () => {
    expect(safeRedirectPath("https://evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("http://evil.example/x", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects protocol-relative targets", () => {
    expect(safeRedirectPath("//evil.example", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects backslash forms browsers normalise to protocol-relative", () => {
    expect(safeRedirectPath("/\\evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("/\\/evil.example", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("\\\\evil.example", FALLBACK)).toBe(FALLBACK);
  });

  it("rejects non-http schemes", () => {
    expect(safeRedirectPath("javascript:alert(1)", FALLBACK)).toBe(FALLBACK);
    expect(safeRedirectPath("data:text/html,<script>", FALLBACK)).toBe(FALLBACK);
  });

  it("normalises embedded control characters rather than passing them through", () => {
    expect(safeRedirectPath("/\tevil.example", FALLBACK)).toBe("/evil.example");
  });

  it("does not treat an encoded slash as an origin change", () => {
    expect(safeRedirectPath("/%2f%2fevil.example", FALLBACK)).toBe("/%2f%2fevil.example");
  });
});
