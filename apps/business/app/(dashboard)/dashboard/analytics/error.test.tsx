import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import AnalyticsError from "./error";

describe("analytics error boundary", () => {
  const html = renderToStaticMarkup(<AnalyticsError error={new Error("db down")} retry={() => {}} />);
  test("shows the message and a retry button, and not the error text", () => {
    expect(html).toContain("Analytics couldn&#x27;t load");
    expect(html).toContain("Try again in a moment.");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(html).not.toContain("db down");
  });
});
