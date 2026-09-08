import { describe, expect, test } from "bun:test";
import {
  promoteOnboardingToProperty,
  type PromotionDeps,
  type PromotionInput,
} from "./promotion";

/**
 * A fake database. `existingSlugs` drives the unique-violation path; `inserts`
 * records every statement so a test can assert on what was written.
 */
function fakeDb(options: { ownsProperty?: boolean; existingSlugs?: string[] } = {}) {
  const existingSlugs = new Set(options.existingSlugs ?? []);
  const inserts: { text: string; values: unknown[] }[] = [];

  const deps: PromotionDeps = {
    async queryOne<T>(text: string, values: unknown[] = []): Promise<T | null> {
      if (text.includes("FROM properties") && text.includes("owner_user_id")) {
        return (options.ownsProperty ? ({ id: "existing-property" } as T) : null);
      }
      if (text.includes("INSERT INTO properties")) {
        inserts.push({ text, values });
        const slug = values[1] as string;
        // ON CONFLICT DO NOTHING returns no row when the slug is taken.
        if (existingSlugs.has(slug)) return null;
        existingSlugs.add(slug);
        return { id: `prop-for-${slug}` } as T;
      }
      return null;
    },
    async query<T>(text: string, values: unknown[] = []): Promise<T[]> {
      inserts.push({ text, values });
      return [];
    },
  };

  return { deps, inserts };
}

function input(overrides: Partial<PromotionInput> = {}): PromotionInput {
  return {
    userId: "user-1",
    userEmail: "host@example.com",
    stepData: {
      "core-info-text": {
        displayName: "Grand Hotel Amsterdam",
        tagline: "Where the city slows down",
        description: "A canal house with eleven rooms.",
        houseRulesText: "No smoking indoors.\n\nQuiet hours from 22:00.",
      },
      "core-info-location": {
        streetAddress: "Herengracht 1",
        city: "Amsterdam",
        country: "NL",
        postalCode: "1015 BA",
        coordinates: [4.8852, 52.3792],
      },
      "legal-n-boring": {
        legalCompanyName: "Grand Hotel BV",
        vatNumber: "NL001234567B01",
        cocNumber: "12345678",
      },
    },
    ...overrides,
  };
}

describe("promoteOnboardingToProperty", () => {
  test("creates a property and returns its id and slug", async () => {
    const { deps } = fakeDb();
    const result = await promoteOnboardingToProperty(input(), deps);
    expect(result).toEqual({
      created: true,
      propertyId: "prop-for-grand-hotel-amsterdam",
      slug: "grand-hotel-amsterdam",
    });
  });

  test("is idempotent — a host who already owns a property is left alone", async () => {
    const { deps, inserts } = fakeDb({ ownsProperty: true });
    const result = await promoteOnboardingToProperty(input(), deps);
    expect(result).toEqual({ created: false, reason: "already-owns-property" });
    expect(inserts.filter((i) => i.text.includes("INSERT"))).toHaveLength(0);
  });

  test("refuses to invent a property with no display name", async () => {
    const { deps } = fakeDb();
    const result = await promoteOnboardingToProperty(
      input({ stepData: { "core-info-location": { city: "Amsterdam" } } }),
      deps,
    );
    expect(result).toEqual({ created: false, reason: "missing-core-info" });
  });

  test("suffixes the slug when it is already taken", async () => {
    const { deps } = fakeDb({ existingSlugs: ["grand-hotel-amsterdam"] });
    const result = await promoteOnboardingToProperty(input(), deps);
    expect(result).toEqual({
      created: true,
      propertyId: "prop-for-grand-hotel-amsterdam-2",
      slug: "grand-hotel-amsterdam-2",
    });
  });

  test("gives up rather than looping forever on pathological collisions", async () => {
    const taken = ["grand-hotel-amsterdam", ...Array.from({ length: 30 }, (_, i) => `grand-hotel-amsterdam-${i + 2}`)];
    const { deps } = fakeDb({ existingSlugs: taken });
    const result = await promoteOnboardingToProperty(input(), deps);
    expect(result).toEqual({ created: false, reason: "slug-exhausted" });
  });

  test("writes longitude before latitude — coordinates are [lon, lat]", async () => {
    const { deps, inserts } = fakeDb();
    await promoteOnboardingToProperty(input(), deps);
    const insert = inserts.find((i) => i.text.includes("INSERT INTO properties"))!;
    expect(insert.text).toContain("ST_MakePoint");
    // Longitude 4.88 is Amsterdam; latitude 52.37 as a longitude would be in Siberia.
    const lonIndex = insert.values.indexOf(4.8852);
    const latIndex = insert.values.indexOf(52.3792);
    expect(lonIndex).toBeGreaterThan(-1);
    expect(lonIndex).toBeLessThan(latIndex);
  });

  test("maps every core field onto the property row in the correct binding order", async () => {
    const { deps, inserts } = fakeDb();
    await promoteOnboardingToProperty(input(), deps);
    const insert = inserts.find((i) => i.text.includes("INSERT INTO properties"))!;
    // Positional binding ($1..$14): containment alone can't catch a swapped
    // pair of bindings (e.g. city/country), a dropped parameter, or a wrong
    // arity, so this pins the exact array — order and all fourteen slots.
    expect(insert.values).toEqual([
      "Grand Hotel Amsterdam", // displayName
      "grand-hotel-amsterdam", // slug candidate
      "Where the city slows down", // tagline
      "Herengracht 1", // streetAddress
      "1015 BA", // postalCode
      "Amsterdam", // city
      "NL", // country
      "Europe/Amsterdam", // timezone
      4.8852, // longitude
      52.3792, // latitude
      "15:00", // check-in default
      "11:00", // check-out default
      null, // stripe_account_id
      "user-1", // userId
    ]);
    // A promoted property can never be born published.
    expect(insert.text).toMatch(/\$13,\s*\$14,\s*false/);
  });

  test("creates the listing content row from the onboarding prose", async () => {
    const { deps, inserts } = fakeDb();
    await promoteOnboardingToProperty(input(), deps);
    const content = inserts.find((i) => i.text.includes("INSERT INTO property_content"))!;
    expect(content.values).toContain("A canal house with eleven rooms.");
    expect(content.values).toContain("Grand Hotel BV");
    expect(content.values).toContain("NL001234567B01");
    expect(content.values).toContain("host@example.com");
  });

  test("splits house rules into fine-print bullets on blank lines", async () => {
    const { deps, inserts } = fakeDb();
    await promoteOnboardingToProperty(input(), deps);
    const content = inserts.find((i) => i.text.includes("INSERT INTO property_content"))!;
    expect(content.values).toContainEqual(["No smoking indoors.", "Quiet hours from 22:00."]);
  });

  test("resolves a timezone from the country", async () => {
    const { deps, inserts } = fakeDb();
    await promoteOnboardingToProperty(input(), deps);
    expect(inserts.find((i) => i.text.includes("INSERT INTO properties"))!.values).toContain("Europe/Amsterdam");
  });

  test("survives a country with no timezone mapping", async () => {
    const { deps, inserts } = fakeDb();
    const i = input();
    i.stepData["core-info-location"]!.country = "ZZ";
    const result = await promoteOnboardingToProperty(i, deps);
    expect(result.created).toBe(true);
    expect(inserts.find((x) => x.text.includes("INSERT INTO properties"))!.values).toContain("Europe/Amsterdam");
  });

  test("survives missing coordinates by writing a null location", async () => {
    const { deps, inserts } = fakeDb();
    const i = input();
    i.stepData["core-info-location"]!.coordinates = null;
    const result = await promoteOnboardingToProperty(i, deps);
    // The property is still created; the editor's Location section will flag
    // the missing pin and block publishing until the host drops one.
    expect(result.created).toBe(true);
    // The nulls must reach the query so SQL COALESCE produces the POINT(0 0)
    // sentinel. Defaulting to 0 in JS here would make "no pin" indistinguishable
    // from a real pin at the origin, and the property would look publishable.
    const values = inserts.find((x) => x.text.includes("INSERT INTO properties"))!.values;
    expect(values[8]).toBeNull();
    expect(values[9]).toBeNull();
  });

  test("survives a completely missing legal step", async () => {
    const { deps } = fakeDb();
    const i = input();
    delete i.stepData["legal-n-boring"];
    expect((await promoteOnboardingToProperty(i, deps)).created).toBe(true);
  });
});
