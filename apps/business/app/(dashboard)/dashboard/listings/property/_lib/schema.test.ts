import { describe, expect, test } from "bun:test";
import {
  identitySchema,
  legalSchema,
  locationSchema,
  overviewSchema,
  policiesSchema,
} from "./schema";

/** A description that clears the 120-character floor. */
const LONG = "A quiet coastal house with eleven rooms, a walled garden, and a kitchen that runs on whatever the boats brought in that morning.";

describe("identitySchema", () => {
  test("accepts a name and tagline", () => {
    const r = identitySchema.safeParse({ name: "Grand Hotel", subtitle: "Where the city slows down" });
    expect(r.success).toBe(true);
  });

  test("rejects an empty name with a message naming the field", () => {
    const r = identitySchema.safeParse({ name: "", subtitle: "x" });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.name?.[0]).toBe("Property name is required.");
  });

  test("rejects whitespace-only input", () => {
    const r = identitySchema.safeParse({ name: "   ", subtitle: "x" });
    expect(r.success).toBe(false);
  });

  test("rejects an empty tagline — the hero renders it under the name", () => {
    const r = identitySchema.safeParse({ name: "Grand Hotel", subtitle: "" });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.subtitle?.[0]).toBe("Tagline is required.");
  });
});

describe("overviewSchema", () => {
  const valid = {
    overviewHeadline: "Where stillness meets the sea",
    overviewDescription: LONG,
    ctaHeadline: "Ready to arrive?",
    ctaBody: "Reserve your stay and let us take care of the rest.",
    amenityIds: ["3f1a0c62-0d3e-4a1f-9c1b-1f2e3d4c5b6a"],
  };

  test("accepts a full overview", () => {
    expect(overviewSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects a description under 120 characters", () => {
    const r = overviewSchema.safeParse({ ...valid, overviewDescription: "Too short." });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.overviewDescription?.[0]).toContain("120");
  });

  test("rejects zero amenities", () => {
    const r = overviewSchema.safeParse({ ...valid, amenityIds: [] });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.amenityIds?.[0]).toBe("Pick at least one amenity.");
  });

  test("rejects a headline over 120 characters", () => {
    const r = overviewSchema.safeParse({ ...valid, overviewHeadline: "x".repeat(121) });
    expect(r.success).toBe(false);
  });
});

describe("policiesSchema", () => {
  const valid = {
    checkInTime: "15:00",
    checkInUntil: "23:00",
    checkOutTime: "11:00",
    reception24h: "on",
    freeCancellationDays: "7",
    prepaymentRequired: "on",
    childrenWelcome: "on",
    minCheckInAge: "18",
    cotPolicy: "free",
    cotFee: "",
    extraBedFee: "60",
    petsAllowed: "",
    paymentMethods: ["visa", "mastercard"],
    finePrint: ["A security deposit of EUR 500 is required upon arrival."],
  };

  test("accepts a full policy set", () => {
    const r = policiesSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  test("turns checkbox values into booleans", () => {
    const r = policiesSchema.safeParse(valid);
    expect(r.data!.reception24h).toBe(true);
    expect(r.data!.petsAllowed).toBe(false);
  });

  test("turns an empty optional time into null, not an empty string", () => {
    const r = policiesSchema.safeParse({ ...valid, checkInUntil: "" });
    expect(r.success).toBe(true);
    expect(r.data!.checkInUntil).toBeNull();
  });

  test("turns an empty optional money field into null, not zero", () => {
    const r = policiesSchema.safeParse(valid);
    expect(r.data!.cotFee).toBeNull();
    expect(r.data!.extraBedFee).toBe(60);
  });

  test("rejects a 12-hour time", () => {
    const r = policiesSchema.safeParse({ ...valid, checkInTime: "3pm" });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.checkInTime?.[0]).toContain("24-hour");
  });

  test("rejects an out-of-range hour", () => {
    expect(policiesSchema.safeParse({ ...valid, checkInTime: "25:00" }).success).toBe(false);
  });

  test("rejects a negative fee", () => {
    const r = policiesSchema.safeParse({ ...valid, extraBedFee: "-5" });
    expect(r.success).toBe(false);
  });

  test("rejects a fractional fee — money is whole currency units", () => {
    expect(policiesSchema.safeParse({ ...valid, extraBedFee: "60.5" }).success).toBe(false);
  });

  test("rejects an implausible minimum age", () => {
    expect(policiesSchema.safeParse({ ...valid, minCheckInAge: "0" }).success).toBe(false);
    expect(policiesSchema.safeParse({ ...valid, minCheckInAge: "130" }).success).toBe(false);
  });

  test("rejects zero payment methods", () => {
    const r = policiesSchema.safeParse({ ...valid, paymentMethods: [] });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.paymentMethods?.[0]).toBe("Pick at least one payment method.");
  });

  test("rejects an unknown payment method", () => {
    expect(policiesSchema.safeParse({ ...valid, paymentMethods: ["bitcoin"] }).success).toBe(false);
  });

  test("rejects zero fine-print bullets", () => {
    const r = policiesSchema.safeParse({ ...valid, finePrint: [] });
    expect(r.success).toBe(false);
  });

  test("drops blank fine-print rows rather than storing them", () => {
    const r = policiesSchema.safeParse({ ...valid, finePrint: ["Real bullet.", "   ", ""] });
    expect(r.success).toBe(true);
    expect(r.data!.finePrint).toEqual(["Real bullet."]);
  });

  test("requires a cot fee when the cot policy is paid", () => {
    const r = policiesSchema.safeParse({ ...valid, cotPolicy: "paid", cotFee: "" });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.cotFee?.[0]).toContain("charge");
  });
});

describe("locationSchema", () => {
  const valid = {
    locationAbout: "Twenty minutes from the airport, and a world away from it.",
    addressLine1: "Via della Quiete 1",
    addressLine2: "",
    postalCode: "57037",
    city: "Portoferraio",
    country: "IT",
    timezone: "Europe/Rome",
    lat: "42.8134",
    lon: "10.3235",
  };

  test("accepts a full address", () => {
    expect(locationSchema.safeParse(valid).success).toBe(true);
  });

  test("turns an empty second address line into null", () => {
    expect(locationSchema.safeParse(valid).data!.addressLine2).toBeNull();
  });

  test("rejects a country that is not two letters", () => {
    expect(locationSchema.safeParse({ ...valid, country: "ITA" }).success).toBe(false);
  });

  test("uppercases the country code", () => {
    expect(locationSchema.safeParse({ ...valid, country: "it" }).data!.country).toBe("IT");
  });

  test("rejects coordinates outside the valid range", () => {
    expect(locationSchema.safeParse({ ...valid, lat: "91" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...valid, lon: "-181" }).success).toBe(false);
  });

  test("rejects a missing map pin — the listing page renders a map", () => {
    const r = locationSchema.safeParse({ ...valid, lat: "", lon: "" });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.lat?.[0]).toBe("Drop a pin on the map.");
  });

  test("rejects the exact origin (0,0) as a sentinel for no pin", () => {
    const r = locationSchema.safeParse({ ...valid, lat: "0", lon: "0" });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.lat?.[0]).toBe("Drop a pin on the map.");
  });

  test("accepts zero latitude (equator) with non-zero longitude", () => {
    const r = locationSchema.safeParse({ ...valid, lat: "0", lon: "4.89" });
    expect(r.success).toBe(true);
  });

  test("accepts non-zero latitude with zero longitude (Greenwich meridian)", () => {
    const r = locationSchema.safeParse({ ...valid, lat: "52.37", lon: "0" });
    expect(r.success).toBe(true);
  });
});

describe("legalSchema", () => {
  const valid = {
    legalCompanyName: "Quiete SRL",
    contactEmail: "reservations@quiete.it",
    contactPhone: "+39 0565 944 111",
    companyRegistration: "IT 03847210491",
    vatNumber: "REA LI-92847",
  };

  test("accepts full business details", () => {
    expect(legalSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects a malformed email", () => {
    const r = legalSchema.safeParse({ ...valid, contactEmail: "not-an-email" });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.contactEmail?.[0]).toContain("email");
  });

  test("rejects an empty VAT number — the guest-facing modal shows it", () => {
    expect(legalSchema.safeParse({ ...valid, vatNumber: "" }).success).toBe(false);
  });
});
