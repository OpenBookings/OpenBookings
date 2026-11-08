import { describe, expect, test } from "bun:test";
import { billingTreatmentForProperty } from "./profiles";
import { NonEuCountryError } from "./vat";

const dbReturning = (rows: unknown[]) => {
  const calls: { text: string; values?: unknown[] }[] = [];
  return {
    calls,
    db: {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows };
      },
    },
  };
};

describe("billingTreatmentForProperty", () => {
  test("reads the country of the property's organization", async () => {
    const { db, calls } = dbReturning([{ country_code: "NL" }]);
    expect(await billingTreatmentForProperty("prop-1", db)).toBe("NL_DOMESTIC");
    expect(calls[0].values).toEqual(["prop-1"]);
    const de = dbReturning([{ country_code: "DE" }]);
    expect(await billingTreatmentForProperty("prop-1", de.db)).toBe("EU_REVERSE_CHARGE");
  });

  test("is null without a profile or without a country", async () => {
    expect(await billingTreatmentForProperty("p", dbReturning([]).db)).toBeNull();
    expect(await billingTreatmentForProperty("p", dbReturning([{ country_code: null }]).db)).toBeNull();
  });

  test("lets a non-EU country through as an error", async () => {
    await expect(billingTreatmentForProperty("p", dbReturning([{ country_code: "US" }]).db)).rejects.toBeInstanceOf(
      NonEuCountryError,
    );
  });
});
