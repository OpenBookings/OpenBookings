import { describe, expect, test } from "bun:test";
import { amenitiesSchema, identitySchema, rateSchema, spaceSchema } from "./schema";

const rate = (over: Record<string, unknown> = {}) => ({
  name: "Bed & Breakfast",
  description: "",
  breakfast: "on",
  lunch: undefined,
  dinner: undefined,
  extras: [],
  otherInclusion: "",
  minAdvanceDays: "0",
  maxAdvanceDays: "none",
  refundable: "true",
  active: undefined,
  ...over,
});

const space = (over: Record<string, unknown> = {}) => ({
  sizeM2: "35",
  maxAdults: "2",
  maxChildren: "0",
  baseOccupancy: "2",
  units: "4",
  beds: { single: "0", double: "0", queen: "0", king: "1", sofa_bed: "0", bunk_bed: "0" },
  ...over,
});

describe("rateSchema", () => {
  test("parses checkboxes, selects and blanks", () => {
    const d = rateSchema.parse(rate({ extras: ["parking", "parking"], maxAdvanceDays: "90" }));
    expect(d.breakfast).toBe(true);
    expect(d.lunch).toBe(false);
    expect(d.extras).toEqual(["parking"]);
    expect(d.maxAdvanceDays).toBe(90);
    expect(d.description).toBeNull();
    expect(d.active).toBe(false);
  });

  test("a rate is refundable or non-refundable", () => {
    expect(rateSchema.parse(rate()).refundable).toBe(true);
    expect(rateSchema.parse(rate({ refundable: "false" })).refundable).toBe(false);
  });

  test("the refund type must be chosen", () => {
    const r = rateSchema.safeParse(rate({ refundable: "" }));
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.refundable?.[0]).toBe("Choose refundable or non-refundable.");
  });

  test("the name is 2 to 60 characters", () => {
    expect(rateSchema.safeParse(rate({ name: "B" })).success).toBe(false);
    expect(rateSchema.safeParse(rate({ name: "x".repeat(61) })).success).toBe(false);
  });

  test("only the offered booking windows are accepted", () => {
    expect(rateSchema.safeParse(rate({ minAdvanceDays: "5" })).success).toBe(false);
    expect(rateSchema.safeParse(rate({ maxAdvanceDays: "30" })).success).toBe(false);
    expect(rateSchema.safeParse(rate({ extras: ["helicopter"] })).success).toBe(false);
  });

  test("description and other inclusion have their own limits", () => {
    expect(rateSchema.safeParse(rate({ description: "x".repeat(201) })).success).toBe(false);
    expect(rateSchema.safeParse(rate({ otherInclusion: "x".repeat(121) })).success).toBe(false);
  });
});

describe("identitySchema", () => {
  test("enforces the description range", () => {
    expect(identitySchema.safeParse({ name: "Deluxe", description: "Too short." }).success).toBe(false);
    expect(
      identitySchema.safeParse({ name: "Deluxe", description: "x".repeat(401) }).success,
    ).toBe(false);
    expect(
      identitySchema.safeParse({ name: "Deluxe", description: "x".repeat(40) }).success,
    ).toBe(true);
  });
});

describe("spaceSchema", () => {
  test("keeps only the bed types the room has", () => {
    expect(spaceSchema.parse(space()).beds).toEqual({ king: 1 });
  });

  test("needs at least one bed", () => {
    const r = spaceSchema.safeParse(
      space({ beds: { single: "0", double: "0", queen: "0", king: "0", sofa_bed: "0", bunk_bed: "0" } }),
    );
    expect(r.success).toBe(false);
    expect(r.error?.flatten().fieldErrors.beds?.[0]).toBe("Add at least one bed.");
  });

  test("rounds the size to the one decimal the column keeps", () => {
    expect(spaceSchema.parse(space({ sizeM2: "35.55" })).sizeM2).toBe(35.6);
    expect(spaceSchema.safeParse(space({ sizeM2: "0" })).success).toBe(false);
  });

  test("bounds adults, children and units", () => {
    expect(spaceSchema.safeParse(space({ maxAdults: "0" })).success).toBe(false);
    expect(spaceSchema.safeParse(space({ maxAdults: "11" })).success).toBe(false);
    expect(spaceSchema.safeParse(space({ maxChildren: "11" })).success).toBe(false);
    expect(spaceSchema.safeParse(space({ units: "0" })).success).toBe(false);
    expect(spaceSchema.safeParse(space({ units: "100" })).success).toBe(false);
    expect(spaceSchema.safeParse(space({ units: "2.5" })).success).toBe(false);
  });

  const errorOn = (input: Record<string, unknown>, field: string) =>
    (spaceSchema.safeParse(space(input)).error?.flatten().fieldErrors as Record<string, string[] | undefined>)?.[field]?.[0];

  test("guests included can't be more than max guests", () => {
    expect(errorOn({ baseOccupancy: "3" }, "baseOccupancy")).toBe(
      "Guests included can be at most 2, your max guests.",
    );
    expect(errorOn({ baseOccupancy: "0" }, "baseOccupancy")).toBeDefined();
    expect(spaceSchema.parse(space({ maxChildren: "1", baseOccupancy: "3" })).baseOccupancy).toBe(3);
  });

  test("an extra-guest fee is kept only where an extra guest can come", () => {
    // Base 2 = max adults 2, no children: nobody can be extra.
    const full = spaceSchema.parse(space({ extraAdultFee: "20", extraChildFee: "10" }));
    expect([full.extraAdultFee, full.extraChildFee]).toEqual([null, null]);

    const roomy = spaceSchema.parse(space({ maxAdults: "3", maxChildren: "1", extraAdultFee: "20", extraChildFee: "" }));
    expect([roomy.extraAdultFee, roomy.extraChildFee]).toEqual([20, 0]);
  });

  test("cots and extra beds switched off store nothing, whatever was posted", () => {
    const d = spaceSchema.parse(space({ cotsMax: "2", cotFee: "15", extraBedsMax: "1", extraBedFee: "25" }));
    expect(d).toMatchObject({ cotsMax: 0, cotFee: null, extraBedsMax: 0, extraBedFee: null });
  });

  test("cots and extra beds switched on need a count; a blank fee is free", () => {
    expect(errorOn({ cotsOn: "on", cotsMax: "0" }, "cotsMax")).toBe("Set how many cots fit, or turn cots off.");
    expect(errorOn({ extraBedsOn: "on", extraBedsMax: "0" }, "extraBedsMax")).toBe(
      "Set how many extra beds fit, or turn extra beds off.",
    );
    expect(errorOn({ cotsOn: "on", cotsMax: "5" }, "cotsMax")).toBeDefined();
    const d = spaceSchema.parse(space({ cotsOn: "on", cotsMax: "2", cotFee: "", extraBedsOn: "on", extraBedsMax: "1", extraBedFee: "25" }));
    expect(d).toMatchObject({ cotsMax: 2, cotFee: 0, extraBedsMax: 1, extraBedFee: 25 });
  });

  test("a cot and an extra bed can be combined unless both are on and the host says no", () => {
    expect(spaceSchema.parse(space()).cotAndExtraBedTogether).toBe(true);
    const both = { cotsOn: "on", cotsMax: "1", extraBedsOn: "on", extraBedsMax: "1" };
    expect(spaceSchema.parse(space(both)).cotAndExtraBedTogether).toBe(false);
    expect(spaceSchema.parse(space({ ...both, cotAndExtraBedTogether: "on" })).cotAndExtraBedTogether).toBe(true);
    expect(spaceSchema.parse(space({ cotsOn: "on", cotsMax: "1" })).cotAndExtraBedTogether).toBe(true);
  });

  test("fees are whole euros up to 9999", () => {
    expect(errorOn({ maxAdults: "3", extraAdultFee: "10000" }, "extraAdultFee")).toBeDefined();
    expect(errorOn({ maxAdults: "3", extraAdultFee: "12.5" }, "extraAdultFee")).toBeDefined();
  });
});

describe("amenitiesSchema", () => {
  test("needs one amenity and features at most six of them", () => {
    expect(amenitiesSchema.safeParse({ amenityKeys: [], featuredAmenityKeys: [] }).success).toBe(false);

    const seven = ["wifi", "safe", "kettle", "minibar", "heating", "bathtub", "balcony"];
    expect(
      amenitiesSchema.safeParse({ amenityKeys: seven, featuredAmenityKeys: seven }).success,
    ).toBe(false);
    expect(
      amenitiesSchema.safeParse({ amenityKeys: seven, featuredAmenityKeys: seven.slice(0, 6) })
        .success,
    ).toBe(true);
  });

  test("only selected amenities can be featured", () => {
    expect(
      amenitiesSchema.safeParse({ amenityKeys: ["wifi"], featuredAmenityKeys: ["safe"] }).success,
    ).toBe(false);
  });

  test("unknown keys are refused", () => {
    expect(
      amenitiesSchema.safeParse({ amenityKeys: ["rooftop_bar"], featuredAmenityKeys: [] }).success,
    ).toBe(false);
  });
});
