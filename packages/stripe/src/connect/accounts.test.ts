import { describe, expect, test } from "bun:test";
import { buildConnectAccountParams } from "./accounts";

const host = { email: "owner@example.com", legalCompanyName: "Acme Hotels BV", country: "be" };

describe("buildConnectAccountParams", () => {
  test("gives the host a full Stripe Dashboard, with Stripe owning requirements, losses and fees", () => {
    expect(buildConnectAccountParams(host).controller).toEqual({
      stripe_dashboard: { type: "full" },
      requirement_collection: "stripe",
      losses: { payments: "stripe" },
      fees: { payer: "account" },
    });
  });

  test("uses the host's own country, upper-cased", () => {
    expect(buildConnectAccountParams(host).country).toBe("BE");
  });

  test("refuses to guess a country", () => {
    expect(() => buildConnectAccountParams({ ...host, country: "" })).toThrow();
    expect(() => buildConnectAccountParams({ ...host, country: "Netherlands" })).toThrow();
  });

  test("leaves business type and company details for the host to enter in Stripe", () => {
    const params = buildConnectAccountParams(host);
    expect(params.business_type).toBeUndefined();
    expect(params.company).toBeUndefined();
    expect(params.business_profile).toEqual({ name: "Acme Hotels BV" });
    expect(params.email).toBe("owner@example.com");
  });

  test("requests what direct charges need", () => {
    expect(buildConnectAccountParams(host).capabilities).toEqual({
      card_payments: { requested: true },
      transfers: { requested: true },
    });
  });
});
