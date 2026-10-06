import { describe, expect, test } from "bun:test";
import {
  amenitiesFromLegacy,
  bedLabel,
  bedsFromLegacyLabel,
  cancellationPreview,
  catalogLabelsFor,
  conditionsSummary,
  copyName,
  formatSize,
  includesSummary,
  mealLabel,
  normaliseBeds,
  roomSummary,
} from "./derive";

const meals = (b: boolean, l: boolean, d: boolean) => ({ breakfast: b, lunch: l, dinner: d });

describe("bedLabel", () => {
  test("one bed reads as its type", () => {
    expect(bedLabel({ king: 1 })).toBe("King");
  });

  test("several beds list counts in a fixed order", () => {
    expect(bedLabel({ sofa_bed: 1, king: 1 })).toBe("1 King · 1 Sofa bed");
    expect(bedLabel({ single: 2 })).toBe("2 Singles");
  });

  test("no beds is empty", () => {
    expect(bedLabel({})).toBe("");
    expect(bedLabel({ king: 0 })).toBe("");
  });
});

describe("formatSize", () => {
  test("drops a trailing .0", () => {
    expect(formatSize(35)).toBe("35 m²");
    expect(formatSize(35.0)).toBe("35 m²");
    expect(formatSize(35.5)).toBe("35.5 m²");
  });

  test("keeps one decimal, as the column does", () => {
    expect(formatSize(35.04)).toBe("35 m²");
    expect(formatSize(35.25)).toBe("35.3 m²");
  });
});

describe("roomSummary", () => {
  test("is the guest card line", () => {
    expect(roomSummary(35, { king: 1 })).toBe("35 m² · King");
  });

  test("falls back to the legacy bed text when no counts exist", () => {
    expect(roomSummary(20, {}, "Twin")).toBe("20 m² · Twin");
  });

  test("leaves out what is missing", () => {
    expect(roomSummary(null, { queen: 1 })).toBe("Queen");
    expect(roomSummary(null, {})).toBe("");
  });
});

describe("bed parsing", () => {
  test("a legacy label that names one bed type becomes one bed", () => {
    expect(bedsFromLegacyLabel("king")).toEqual({ king: 1 });
    expect(bedsFromLegacyLabel("Sofa bed")).toEqual({ sofa_bed: 1 });
  });

  test("anything else is left for the host", () => {
    expect(bedsFromLegacyLabel("1 King + 1 Sofa")).toEqual({});
    expect(bedsFromLegacyLabel(null)).toEqual({});
  });

  test("normaliseBeds keeps only known types with positive whole counts", () => {
    expect(normaliseBeds({ king: 1, waterbed: 2, single: 0, double: 1.5, queen: "2" })).toEqual({
      king: 1,
    });
    expect(normaliseBeds(null)).toEqual({});
    expect(normaliseBeds("king")).toEqual({});
  });
});

describe("mealLabel", () => {
  test("follows the board terms", () => {
    expect(mealLabel(meals(false, false, false))).toBe("Room only");
    expect(mealLabel(meals(true, false, false))).toBe("Breakfast included");
    expect(mealLabel(meals(true, false, true))).toBe("Half board");
    expect(mealLabel(meals(true, true, true))).toBe("Full board");
  });

  test("lists any other combination", () => {
    expect(mealLabel(meals(true, true, false))).toBe("Breakfast and lunch");
    expect(mealLabel(meals(false, true, true))).toBe("Lunch and dinner");
    expect(mealLabel(meals(false, false, true))).toBe("Dinner included");
  });
});

describe("includesSummary", () => {
  const rate = { ...meals(false, false, false), extras: [] as string[], otherInclusion: null };

  test("meals, extras, then the free-text line", () => {
    expect(
      includesSummary({ ...rate, breakfast: true, extras: ["parking"], otherInclusion: "Wine" }),
    ).toBe("Breakfast · Parking · Wine");
  });

  test("uses the board term where there is one", () => {
    expect(includesSummary({ ...rate, ...meals(true, false, true) })).toBe("Half board");
  });

  test("nothing included is room only", () => {
    expect(includesSummary(rate)).toBe("Room only");
    expect(includesSummary({ ...rate, otherInclusion: "   " })).toBe("Room only");
  });

  test("ignores unknown extra keys", () => {
    expect(includesSummary({ ...rate, extras: ["helicopter"] })).toBe("Room only");
  });
});

describe("conditionsSummary", () => {
  test.each([
    [0, null, "None"],
    [3, null, "Book 3+ days ahead"],
    [1, null, "Book 1+ day ahead"],
    [0, 90, "Book up to 90 days ahead"],
    [7, 365, "Book 7–365 days ahead"],
  ] as const)("min %p, max %p", (min, max, expected) => {
    expect(conditionsSummary(min, max)).toBe(expected);
  });
});

describe("cancellationPreview", () => {
  test("is the first non-empty line", () => {
    expect(cancellationPreview("Free until 48 hours before.\nAfter that, one night.")).toBe(
      "Free until 48 hours before.",
    );
  });

  test("blank is no policy", () => {
    expect(cancellationPreview(null)).toBeNull();
    expect(cancellationPreview("  \n ")).toBeNull();
  });
});

describe("copyName", () => {
  test("appends (copy)", () => {
    expect(copyName("Bed & Breakfast", 60)).toBe("Bed & Breakfast (copy)");
  });

  test("stays inside the limit", () => {
    const long = "x".repeat(60);
    expect(copyName(long, 60)).toHaveLength(60);
    expect(copyName(long, 60).endsWith(" (copy)")).toBe(true);
  });
});

describe("legacy amenities", () => {
  test("catalogue labels map to keys, unknown ones are dropped", () => {
    expect(amenitiesFromLegacy(["Rain Shower", "Free Wi-Fi", "Infinity Pool"])).toEqual({
      amenityKeys: ["rain_shower", "wifi"],
      featuredAmenityKeys: ["rain_shower", "wifi"],
    });
  });

  test("the featured set is capped at six", () => {
    const labels = ["Rain Shower", "Bathtub", "Jacuzzi", "Hairdryer", "Bathrobes", "Slippers", "Kettle"];
    const { amenityKeys, featuredAmenityKeys } = amenitiesFromLegacy(labels);
    expect(amenityKeys).toHaveLength(7);
    expect(featuredAmenityKeys).toHaveLength(6);
  });

  test("featured keys mirror back to catalogue labels where one exists", () => {
    expect(catalogLabelsFor(["minibar", "toiletries", "wifi"])).toEqual(["Mini Bar", "Free Wi-Fi"]);
  });
});
