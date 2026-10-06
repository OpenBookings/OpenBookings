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
  cancellationText: "",
  active: undefined,
  ...over,
});

const space = (over: Record<string, unknown> = {}) => ({
  sizeM2: "35",
  maxAdults: "2",
  maxChildren: "0",
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

  test("cancellation is optional: blank is stored as no policy", () => {
    expect(rateSchema.parse(rate()).cancellationText).toBeNull();
    expect(rateSchema.parse(rate({ cancellationText: "   " })).cancellationText).toBeNull();
  });

  test("cancellation is free text, checked for length only", () => {
    const text = "Free until 2 days before.\nAfter that: 100% (no refund) — sorry!";
    expect(rateSchema.parse(rate({ cancellationText: text })).cancellationText).toBe(text);
    expect(rateSchema.parse(rate({ cancellationText: "x".repeat(500) })).cancellationText).toHaveLength(500);
    expect(rateSchema.safeParse(rate({ cancellationText: "x".repeat(501) })).success).toBe(false);
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
