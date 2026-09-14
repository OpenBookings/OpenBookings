import { describe, expect, test } from "bun:test";
import { allSectionStatuses, canPublish, completedCount, sectionStatus } from "./completion";
import type { PropertyEditorData } from "./types";

const LONG = "A quiet coastal house with eleven rooms, a walled garden, and a kitchen that runs on whatever the boats brought in that morning.";

/** A property with every section complete. Tests subtract from this. */
function complete(): PropertyEditorData {
  return {
    property: {
      id: "p1",
      name: "Grand Hotel",
      slug: "grand-hotel",
      subtitle: "Where the city slows down",
      addressLine1: "Via della Quiete 1",
      addressLine2: null,
      postalCode: "57037",
      city: "Portoferraio",
      country: "IT",
      timezone: "Europe/Rome",
      lat: 42.8134,
      lon: 10.3235,
      checkInTime: "15:00",
      checkInUntil: "23:00",
      checkOutTime: "11:00",
      isActive: false,
    },
    content: {
      overviewHeadline: "Where stillness meets the sea",
      overviewDescription: LONG,
      locationAbout: "Twenty minutes from the airport, and a world away from it.",
      ctaHeadline: "Ready to arrive?",
      ctaBody: "Reserve your stay and let us take care of the rest.",
      finePrint: ["A security deposit is required on arrival."],
      reception24h: true,
      freeCancellationDays: 7,
      prepaymentRequired: true,
      childrenWelcome: true,
      minCheckInAge: 18,
      cotPolicy: "free",
      cotFee: null,
      extraBedFee: 60,
      petsAllowed: false,
      paymentMethods: ["visa", "mastercard"],
      legalCompanyName: "Quiete SRL",
      contactEmail: "reservations@quiete.it",
      contactPhone: "+39 0565 944 111",
      companyRegistration: "IT 03847210491",
      vatNumber: "REA LI-92847",
    },
    images: [
      { id: "i0", url: "u0", group: "hero-image", sortOrder: 0, altText: "Hero" },
      { id: "i1", url: "u1", group: "gallery", sortOrder: 0, altText: "Terrace" },
      { id: "i2", url: "u2", group: "gallery", sortOrder: 1, altText: "Garden" },
      { id: "i3", url: "u3", group: "gallery", sortOrder: 2, altText: "Kitchen" },
    ],
    highlights: [],
    amenityIds: ["a1"],
  };
}

describe("sectionStatus — identity", () => {
  test("is complete when name and tagline are set", () => {
    expect(sectionStatus("identity", complete()).complete).toBe(true);
  });

  test("reports a missing tagline by its label", () => {
    const d = complete();
    d.property.subtitle = null;
    const s = sectionStatus("identity", d);
    expect(s.complete).toBe(false);
    expect(s.missing).toEqual(["Tagline"]);
  });

  test("treats whitespace as missing", () => {
    const d = complete();
    d.property.name = "   ";
    expect(sectionStatus("identity", d).missing).toEqual(["Property name"]);
  });
});

describe("sectionStatus — photos", () => {
  test("is complete with a hero and three captioned gallery images", () => {
    expect(sectionStatus("photos", complete()).complete).toBe(true);
  });

  test("reports a missing hero image", () => {
    const d = complete();
    d.images = d.images.filter((i) => i.group !== "hero-image");
    expect(sectionStatus("photos", d).missing).toContain("Hero image");
  });

  test("requires three gallery images", () => {
    const d = complete();
    d.images = d.images.filter((i) => i.group !== "gallery").concat([
      { id: "i1", url: "u1", group: "gallery", sortOrder: 0, altText: "Terrace" },
    ]);
    expect(sectionStatus("photos", d).missing).toContain("At least 3 gallery photos");
  });

  test("requires alt text on every gallery image", () => {
    const d = complete();
    d.images[2].altText = null;
    expect(sectionStatus("photos", d).missing).toContain("Alt text on every photo");
  });

  test("does not require alt text on the hero or the logo", () => {
    const d = complete();
    d.images[0].altText = null;
    d.images.push({ id: "l", url: "ul", group: "logo", sortOrder: 0, altText: null });
    expect(sectionStatus("photos", d).complete).toBe(true);
  });
});

describe("sectionStatus — overview", () => {
  test("is complete when prose and amenities are set", () => {
    expect(sectionStatus("overview", complete()).complete).toBe(true);
  });

  test("requires at least one amenity", () => {
    const d = complete();
    d.amenityIds = [];
    expect(sectionStatus("overview", d).missing).toContain("At least one amenity");
  });

  test("requires a description of at least 120 characters", () => {
    const d = complete();
    d.content.overviewDescription = "Too short.";
    expect(sectionStatus("overview", d).missing).toContain("Description");
  });

  test("requires a headline", () => {
    const d = complete();
    d.content.overviewHeadline = null;
    expect(sectionStatus("overview", d).missing).toContain("Headline");
  });

  test("requires a closing headline", () => {
    const d = complete();
    d.content.ctaHeadline = null;
    expect(sectionStatus("overview", d).missing).toContain("Closing headline");
  });

  test("requires a closing message", () => {
    const d = complete();
    d.content.ctaBody = null;
    expect(sectionStatus("overview", d).missing).toContain("Closing message");
  });
});

describe("sectionStatus — policies", () => {
  test("is complete for the fixture", () => {
    expect(sectionStatus("policies", complete()).complete).toBe(true);
  });

  test("treats a zero cancellation window as set, not missing", () => {
    const d = complete();
    d.content.freeCancellationDays = 0;
    expect(sectionStatus("policies", d).complete).toBe(true);
  });

  test("reports a null cancellation window", () => {
    const d = complete();
    d.content.freeCancellationDays = null;
    expect(sectionStatus("policies", d).missing).toContain("Free cancellation window");
  });

  test("requires at least one payment method", () => {
    const d = complete();
    d.content.paymentMethods = [];
    expect(sectionStatus("policies", d).missing).toContain("Accepted payment methods");
  });

  test("requires at least one fine-print line", () => {
    const d = complete();
    d.content.finePrint = [];
    expect(sectionStatus("policies", d).missing).toContain("Fine print");
  });

  test("requires a cot fee when the cot policy is paid", () => {
    const d = complete();
    d.content.cotPolicy = "paid";
    d.content.cotFee = null;
    expect(sectionStatus("policies", d).missing).toContain("Cot fee");
  });

  test("requires a check-in time", () => {
    const d = complete();
    d.property.checkInTime = "";
    expect(sectionStatus("policies", d).missing).toContain("Check-in time");
  });

  test("requires a check-out time", () => {
    const d = complete();
    d.property.checkOutTime = "";
    expect(sectionStatus("policies", d).missing).toContain("Check-out time");
  });

  test("requires a minimum check-in age", () => {
    const d = complete();
    d.content.minCheckInAge = null;
    expect(sectionStatus("policies", d).missing).toContain("Minimum check-in age");
  });

  test("rejects a minimum check-in age of zero", () => {
    const d = complete();
    d.content.minCheckInAge = 0;
    expect(sectionStatus("policies", d).missing).toContain("Minimum check-in age");
  });

  test("accepts a minimum check-in age of one or greater", () => {
    const d = complete();
    d.content.minCheckInAge = 18;
    expect(sectionStatus("policies", d).complete).toBe(true);
  });
});

describe("sectionStatus — location", () => {
  test("is complete for the fixture", () => {
    expect(sectionStatus("location", complete()).complete).toBe(true);
  });

  test("requires a map pin", () => {
    const d = complete();
    d.property.lat = null;
    expect(sectionStatus("location", d).missing).toContain("Map pin");
  });

  test("treats the 0,0 origin as no pin at all", () => {
    // properties.location is NOT NULL, so onboarding promotion writes
    // POINT(0 0) for a host who never placed a pin. Without this, that host
    // reads as complete and can publish a listing pointing at open ocean.
    const d = complete();
    d.property.lat = 0;
    d.property.lon = 0;
    expect(sectionStatus("location", d).missing).toContain("Map pin");
  });

  test("accepts a real pin that merely has a zero in one axis", () => {
    // Greenwich meridian and the equator are real places; only the exact
    // origin is the sentinel.
    const d = complete();
    d.property.lon = 0;
    expect(sectionStatus("location", d).complete).toBe(true);
  });

  test("does not require nearby highlights", () => {
    const d = complete();
    d.highlights = [];
    expect(sectionStatus("location", d).complete).toBe(true);
  });

  test("does not require a second address line", () => {
    const d = complete();
    d.property.addressLine2 = null;
    expect(sectionStatus("location", d).complete).toBe(true);
  });

  test("requires location about text", () => {
    const d = complete();
    d.content.locationAbout = null;
    expect(sectionStatus("location", d).missing).toContain("About");
  });

  test("requires an address", () => {
    const d = complete();
    d.property.addressLine1 = "";
    expect(sectionStatus("location", d).missing).toContain("Address");
  });

  test("requires a postal code", () => {
    const d = complete();
    d.property.postalCode = "";
    expect(sectionStatus("location", d).missing).toContain("Postal code");
  });

  test("requires a city", () => {
    const d = complete();
    d.property.city = "";
    expect(sectionStatus("location", d).missing).toContain("City");
  });

  test("requires a country", () => {
    const d = complete();
    d.property.country = "";
    expect(sectionStatus("location", d).missing).toContain("Country");
  });

  test("requires a timezone", () => {
    const d = complete();
    d.property.timezone = "";
    expect(sectionStatus("location", d).missing).toContain("Timezone");
  });
});

describe("sectionStatus — legal", () => {
  test("is complete for the fixture", () => {
    expect(sectionStatus("legal", complete()).complete).toBe(true);
  });

  test("reports every missing business detail at once", () => {
    const d = complete();
    d.content.vatNumber = null;
    d.content.contactPhone = null;
    const s = sectionStatus("legal", d);
    expect(s.missing).toEqual(["Contact phone", "VAT number"]);
  });

  test("requires a legal company name", () => {
    const d = complete();
    d.content.legalCompanyName = null;
    expect(sectionStatus("legal", d).missing).toContain("Legal company name");
  });

  test("requires a contact email", () => {
    const d = complete();
    d.content.contactEmail = null;
    expect(sectionStatus("legal", d).missing).toContain("Contact email");
  });

  test("requires a company registration", () => {
    const d = complete();
    d.content.companyRegistration = null;
    expect(sectionStatus("legal", d).missing).toContain("Company registration");
  });
});

describe("canPublish", () => {
  test("is true when every section is complete", () => {
    expect(canPublish(complete())).toBe(true);
  });

  test("is false when any single section is incomplete", () => {
    for (const mutate of [
      (d: PropertyEditorData) => { d.property.subtitle = null; },
      (d: PropertyEditorData) => { d.images = []; },
      (d: PropertyEditorData) => { d.amenityIds = []; },
      (d: PropertyEditorData) => { d.content.finePrint = []; },
      (d: PropertyEditorData) => { d.property.lat = null; },
      (d: PropertyEditorData) => { d.content.vatNumber = null; },
    ]) {
      const d = complete();
      mutate(d);
      expect(canPublish(d)).toBe(false);
    }
  });
});

describe("completedCount", () => {
  test("counts six when everything is done", () => {
    expect(completedCount(complete())).toBe(6);
  });

  test("counts five when one section is short", () => {
    const d = complete();
    d.content.vatNumber = null;
    expect(completedCount(d)).toBe(5);
  });
});

describe("allSectionStatuses", () => {
  test("returns an entry for every section id", () => {
    const all = allSectionStatuses(complete());
    expect(Object.keys(all).sort()).toEqual(
      ["identity", "legal", "location", "overview", "policies", "photos"].sort(),
    );
  });
});
