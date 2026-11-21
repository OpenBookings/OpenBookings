import { describe, expect, test } from "bun:test";
import type { CurrentProperty } from "@openbookings/authz";
import { loadPayoutStatus, type PayoutDeps } from "./payout-status";

const ORG = "org-current";
const PROPERTY = "11111111-1111-4111-8111-111111111111";
const current = (role: string, hasPropertyAccess = false): CurrentProperty => ({
  propertyId: PROPERTY,
  propertyName: "Zeezicht",
  logoUrl: null,
  organizationId: ORG,
  organizationName: "Zeezicht BV",
  role,
  hasPropertyAccess,
});

function fake(account: string | null) {
  const seen: { sql: string; values: unknown[] }[] = [];
  let stripe = 0;
  const deps: PayoutDeps = {
    queryOne: async <T,>(sql: string, values: unknown[] = []) => {
      seen.push({ sql, values });
      return { stripe_account_id: account } as T;
    },
    retrieveAccount: async () => {
      stripe += 1;
      return { payouts_enabled: true, requirements: { currently_due: ["x"] } };
    },
  };
  return { deps, seen, stripeCalls: () => stripe };
}

describe("payout status", () => {
  test("reads the current organization's Stripe account, then the current hotel's own", async () => {
    const { deps, seen } = fake("acct_1");
    expect(await loadPayoutStatus(current("owner"), "u1", deps)).toEqual({ state: "ok", payoutsEnabled: true, requirementsDue: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0].values).toEqual([ORG, PROPERTY]);
    expect(seen[0].sql).toContain("org_profile");
    expect(seen[0].sql).toContain("organization_id = $1");
    expect(seen[0].sql).toContain("p.id = $2");
    expect(seen[0].sql).not.toContain("host_onboarding");
  });

  test("never shows the user's own onboarding account on a hotel whose org has none", async () => {
    // The user's onboarding account belongs to another org of theirs (or the
    // demo org has none): only a query that reads host_onboarding finds it.
    const seen: string[] = [];
    let stripe = 0;
    const deps: PayoutDeps = {
      queryOne: async <T,>(sql: string) => {
        seen.push(sql);
        return { stripe_account_id: sql.includes("host_onboarding") ? "acct_other_org" : null } as T;
      },
      retrieveAccount: async () => {
        stripe += 1;
        return { payouts_enabled: true };
      },
    };
    expect(await loadPayoutStatus(current("owner"), "u1", deps)).toEqual({ state: "none" });
    expect(stripe).toBe(0);
  });

  test("is hidden from a role that may not read payouts, without asking the database or Stripe", async () => {
    const { deps, seen, stripeCalls } = fake("acct_1");
    expect(await loadPayoutStatus(current("frontdesk", true), "u1", deps)).toEqual({ state: "hidden" });
    expect(seen).toEqual([]);
    expect(stripeCalls()).toBe(0);
  });

  test("no connected account is none", async () => {
    const { deps } = fake(null);
    expect(await loadPayoutStatus(current("owner"), "u1", deps)).toEqual({ state: "none" });
  });

  test("without a current hotel only the user's own onboarding counts", async () => {
    const { deps, seen } = fake("acct_own");
    expect((await loadPayoutStatus(null, "u1", deps)).state).toBe("ok");
    expect(seen[0].values).toEqual(["u1"]);
    expect(seen[0].sql).not.toContain("org_profile");
  });

  test("Stripe being down is unavailable, not an error page", async () => {
    const { deps } = fake("acct_1");
    deps.retrieveAccount = async () => {
      throw new Error("down");
    };
    expect(await loadPayoutStatus(current("owner"), "u1", deps)).toEqual({ state: "unavailable" });
  });
});
