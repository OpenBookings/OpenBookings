import { describe, expect, test } from "bun:test";
import { allSectionStatuses, canPublish, completedCount, sectionStatus } from "./completion";
import type { RatePlanRecord, RoomEditorData } from "./types";

const rate = (over: Partial<RatePlanRecord> = {}): RatePlanRecord => ({
  id: "rate-1",
  roomId: "room-1",
  name: "Bed & Breakfast",
  description: null,
  breakfast: true,
  lunch: false,
  dinner: false,
  extras: [],
  otherInclusion: null,
  minAdvanceDays: 0,
  maxAdvanceDays: null,
  cancellationText: null,
  active: true,
  priced: true,
  sortOrder: 0,
  ...over,
});

const photo = (n: number, alt: string | null = `Photo ${n}`) => ({
  id: `p${n}`,
  url: `https://img/${n}.jpg`,
  sortOrder: n,
  altText: alt,
});

/** A room with every section complete; tests knock out one thing at a time. */
function complete(): RoomEditorData {
  return {
    property: { id: "prop-1", name: "Hotel" },
    room: {
      id: "room-1",
      propertyId: "prop-1",
      name: "Deluxe King",
      description: "A corner room with a king bed, a rain shower and a canal view.",
      sizeM2: 35,
      beds: { king: 1 },
      maxAdults: 2,
      maxChildren: 1,
      units: 4,
      amenityKeys: ["wifi"],
      featuredAmenityKeys: ["wifi"],
      sortOrder: 0,
      status: "draft",
    },
    photos: [photo(1), photo(2), photo(3)],
    rates: [rate()],
  };
}

describe("room completion", () => {
  test("a fully filled room can be published", () => {
    const data = complete();
    expect(completedCount(data)).toBe(5);
    expect(canPublish(data)).toBe(true);
    expect(Object.values(allSectionStatuses(data)).every((s) => s.complete)).toBe(true);
  });

  test("identity needs a 2–60 character name and a 40–400 character description", () => {
    const short = complete();
    short.room.name = "A";
    expect(sectionStatus("identity", short).missing).toEqual(["Room name"]);

    const terse = complete();
    terse.room.description = "Nice room.";
    expect(sectionStatus("identity", terse).complete).toBe(false);

    const long = complete();
    long.room.description = "x".repeat(401);
    expect(sectionStatus("identity", long).complete).toBe(false);
  });

  test("space needs a size and at least one bed", () => {
    const data = complete();
    data.room.sizeM2 = null;
    data.room.beds = {};
    expect(sectionStatus("space", data).missing).toEqual(["Size", "At least one bed"]);
  });

  test("photos need three, each with alt text", () => {
    const two = complete();
    two.photos = [photo(1), photo(2)];
    expect(sectionStatus("photos", two).missing).toEqual(["At least 3 photos"]);

    const unlabelled = complete();
    unlabelled.photos = [photo(1), photo(2), photo(3, "  ")];
    expect(sectionStatus("photos", unlabelled).missing).toEqual(["Alt text on every photo"]);
  });

  test("amenities need at least one", () => {
    const data = complete();
    data.room.amenityKeys = [];
    expect(sectionStatus("amenities", data).complete).toBe(false);
  });

  test("rates need at least one active rate", () => {
    const none = complete();
    none.rates = [];
    expect(sectionStatus("rates", none).complete).toBe(false);

    const inactive = complete();
    inactive.rates = [rate({ active: false })];
    expect(sectionStatus("rates", inactive).complete).toBe(false);
    expect(canPublish(inactive)).toBe(false);
  });
});
