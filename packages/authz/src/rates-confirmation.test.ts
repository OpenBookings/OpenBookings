import { describe, expect, test } from "bun:test";
import {
  RATES_TAX_INCLUSIVE_DOC_ID,
  propertyRatesConfirmed,
  ratePlanRatesConfirmed,
  roomRatesConfirmed,
  userCanConfirmRates,
} from "./rates-confirmation";

/**
 * Fake DB. org-yes has confirmed under the current doc id; org-old confirmed
 * an earlier wording; prop-none has no organisation at all.
 */
const properties = [
  { id: "prop-yes", org: "org-yes" },
  { id: "prop-old", org: "org-old" },
  { id: "prop-no", org: "org-no" },
  { id: "prop-none", org: null },
];
const consents = [
  { org: "org-yes", doc: RATES_TAX_INCLUSIVE_DOC_ID },
  { org: "org-old", doc: "rates-tax-inclusive@2025-01-01" },
  { org: "org-no", doc: "partner-agreement" },
];
const rooms = [{ id: "room-yes", prop: "prop-yes" }, { id: "room-no", prop: "prop-no" }];
const plans = [{ id: "plan-yes", room: "room-yes" }, { id: "plan-no", room: "room-no" }];
const members = [
  { org: "org-no", user: "owner-1", role: "owner" },
  { org: "org-no", user: "admin-1", role: "admin" },
  { org: "org-no", user: "manager-1", role: "manager" },
  { org: "org-yes", user: "owner-2", role: "owner" },
];

const fakeQueryOne = async <T>(text: string, values: unknown[] = []): Promise<T | null> => {
  if (text.includes('JOIN "member"')) {
    const [propertyId, userId] = values as [string, string];
    const org = properties.find((p) => p.id === propertyId)?.org;
    const hit = members.find((m) => m.org === org && m.user === userId && ["owner", "admin"].includes(m.role));
    return (hit ? { ok: true } : null) as T | null;
  }
  const [id, docId] = values as [string, string];
  let propertyId: string | undefined = id;
  if (text.includes("FROM rate_plans")) propertyId = rooms.find((r) => r.id === plans.find((p) => p.id === id)?.room)?.prop;
  else if (text.includes("FROM rooms")) propertyId = rooms.find((r) => r.id === id)?.prop;
  const property = properties.find((p) => p.id === propertyId);
  if (!property) return null;
  const confirmed = consents.some((c) => c.org === property.org && c.doc === docId);
  return { confirmed } as T;
};
const deps = { queryOne: fakeQueryOne };

describe("inclusive-rates confirmation", () => {
  test("the doc id is dated, so a wording change forces re-confirmation", () => {
    expect(RATES_TAX_INCLUSIVE_DOC_ID).toBe("rates-tax-inclusive@2026-10-02");
  });

  test("a property whose organisation confirmed is confirmed", async () => {
    expect(await propertyRatesConfirmed("prop-yes", deps)).toBe(true);
  });

  test("an organisation that never confirmed is not", async () => {
    expect(await propertyRatesConfirmed("prop-no", deps)).toBe(false);
  });

  test("a confirmation of an earlier wording does not count", async () => {
    expect(await propertyRatesConfirmed("prop-old", deps)).toBe(false);
  });

  test("a property with no organisation fails closed", async () => {
    expect(await propertyRatesConfirmed("prop-none", deps)).toBe(false);
  });

  test("unknown and empty ids fail closed", async () => {
    expect(await propertyRatesConfirmed("nope", deps)).toBe(false);
    expect(await propertyRatesConfirmed("", deps)).toBe(false);
    expect(await roomRatesConfirmed("nope", deps)).toBe(false);
    expect(await ratePlanRatesConfirmed("", deps)).toBe(false);
  });

  test("rooms and rate plans resolve through to their property", async () => {
    expect(await roomRatesConfirmed("room-yes", deps)).toBe(true);
    expect(await roomRatesConfirmed("room-no", deps)).toBe(false);
    expect(await ratePlanRatesConfirmed("plan-yes", deps)).toBe(true);
    expect(await ratePlanRatesConfirmed("plan-no", deps)).toBe(false);
  });
});

describe("who may confirm", () => {
  const session = (id: string) => ({ user: { id } });

  test("an owner or admin of the property's organisation", async () => {
    expect(await userCanConfirmRates(session("owner-1"), "prop-no", deps)).toBe(true);
    expect(await userCanConfirmRates(session("admin-1"), "prop-no", deps)).toBe(true);
  });

  test("a manager cannot", async () => {
    expect(await userCanConfirmRates(session("manager-1"), "prop-no", deps)).toBe(false);
  });

  test("an owner of a different organisation cannot", async () => {
    expect(await userCanConfirmRates(session("owner-2"), "prop-no", deps)).toBe(false);
  });

  test("no session fails closed", async () => {
    expect(await userCanConfirmRates(null, "prop-no", deps)).toBe(false);
  });
});
