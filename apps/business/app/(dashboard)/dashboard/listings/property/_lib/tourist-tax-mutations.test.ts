import { describe, expect, test } from "bun:test";
import type { SessionLike } from "@openbookings/authz";
import {
  addTouristTaxRule,
  deleteTouristTaxRule,
  NotFoundError,
  type TouristTaxDeps,
} from "./tourist-tax-mutations";

/**
 * Both writes must refuse a caller who does not own the property before
 * anything is written. No database: the fake answers authz's ownership query
 * and records every statement, so "nothing was written" is asserted directly.
 * The SQL rules themselves (dates, duplicates) are in the .db.test.
 */

const OWNER = "host-owner";
const STRANGER = "host-stranger";
const PROPERTY = "11111111-1111-1111-1111-111111111111";
const RULE = "44444444-4444-4444-4444-444444444444";

const session = (id: string): SessionLike => ({ user: { id, account_type: "business" } });

const rule = {
  effectiveFrom: "2031-01-01",
  charges: [{ kind: "fixed", amount: 2.5, perPerson: true, perNight: true, perRoom: false }],
  childrenExempt: false,
  maxNights: null,
};

function fakeDeps() {
  const statements: string[] = [];
  const deps: TouristTaxDeps = {
    queryOne: async <T,>(sql: string, values: unknown[] = []): Promise<T | null> => {
      statements.push(sql);
      if (/SELECT TRUE AS ok/.test(sql)) {
        const [id, userId] = values as [string, string];
        return (id === PROPERTY && userId === OWNER ? { ok: true } : null) as T | null;
      }
      if (/RETURNING/.test(sql)) return { id: RULE } as T;
      return null;
    },
  };
  const writes = () => statements.filter((s) => /^\s*(INSERT|UPDATE|DELETE)/i.test(s));
  return { deps, writes };
}

describe("a host who does not own the property", () => {
  const stranger = session(STRANGER);

  test("cannot add a rule, and nothing is written", async () => {
    const { deps, writes } = fakeDeps();
    await expect(addTouristTaxRule(stranger, PROPERTY, rule, deps)).rejects.toBeInstanceOf(NotFoundError);
    expect(writes()).toEqual([]);
  });

  test("cannot delete a rule, and nothing is written", async () => {
    const { deps, writes } = fakeDeps();
    await expect(deleteTouristTaxRule(stranger, PROPERTY, RULE, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(writes()).toEqual([]);
  });
});

describe("the owner", () => {
  const owner = session(OWNER);

  test("can add a valid rule", async () => {
    const { deps, writes } = fakeDeps();
    expect(await addTouristTaxRule(owner, PROPERTY, rule, deps)).toEqual({ ok: true, ruleId: RULE });
    expect(writes().length).toBe(1);
  });

  test("gets field errors for an invalid rule, and nothing is written", async () => {
    const { deps, writes } = fakeDeps();
    const result = await addTouristTaxRule(owner, PROPERTY, { ...rule, effectiveFrom: "" }, deps);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe("Choose the date this rule starts.");
    expect(writes()).toEqual([]);
  });
});
