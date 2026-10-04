import { describe, expect, test } from "bun:test";
import { renderPayoutChangeAlert } from "./payout-change-alert";

const at = new Date("2026-10-02T12:00:00Z");

describe("renderPayoutChangeAlert", () => {
  test("says what changed, for which organisation, and shows only the last four digits", () => {
    const { subject, text } = renderPayoutChangeAlert(
      { organisationName: "Acme Hotels", change: "updated", last4: "6789", country: "NL" },
      at,
    );
    expect(subject).toBe("The payout bank account for Acme Hotels was changed");
    expect(text).toContain("ending in 6789");
    expect(text).toContain("Netherlands");
    expect(text).toContain("2 Oct 2026");
  });

  test("words each kind of change", () => {
    const subject = (change: "created" | "updated" | "deleted") =>
      renderPayoutChangeAlert({ organisationName: "Acme", change, last4: "1", country: null }, at).subject;
    expect(subject("created")).toContain("was added");
    expect(subject("deleted")).toContain("was removed");
  });

  test("copes with details Stripe did not send", () => {
    const { text } = renderPayoutChangeAlert({ organisationName: "Acme", change: "updated", last4: null, country: null }, at);
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });

  test("tells the reader what to do if it was not them, and never links to a sign-in page", () => {
    const { text } = renderPayoutChangeAlert({ organisationName: "Acme", change: "updated", last4: "6789", country: "NL" }, at);
    expect(text).toContain("If this was not you");
    // Sent from a no-reply address, so it must name one that is read.
    expect(text).toContain("support@openbookings.co");
    expect(text).not.toMatch(/reply to this email/i);
    expect(text).toContain("dashboard.stripe.com");
    expect(text).not.toMatch(/https?:\/\/[^\s]*login/);
  });

  test("an organisation name cannot inject markup into the HTML", () => {
    const { html } = renderPayoutChangeAlert({ organisationName: "<script>x</script>", change: "updated", last4: "1", country: null }, at);
    expect(html).not.toContain("<script>");
  });
});
