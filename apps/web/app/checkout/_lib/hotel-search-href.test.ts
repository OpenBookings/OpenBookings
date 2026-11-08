import { describe, expect, test } from "bun:test";
import { hotelSearchHref } from "./hotel-search-href";

describe("hotelSearchHref", () => {
  test("goes back to the hotel with the same dates and the whole party", () => {
    const href = hotelSearchHref({
      propertySlug: "casa-lisboa",
      checkIn: "2031-11-10",
      checkOut: "2031-11-13",
      rooms: [
        { adults: 2, children: 1 },
        { adults: 1, children: 0 },
      ],
    });
    expect(href).toBe("/p/casa-lisboa?checkin=2031-11-10&checkout=2031-11-13&adults=3&children=1&rooms=2");
  });

  test("a slug is escaped rather than trusted", () => {
    const href = hotelSearchHref({ propertySlug: "a/b?c", checkIn: "2031-11-10", checkOut: "2031-11-11", rooms: [{ adults: 1, children: 0 }] });
    expect(href.startsWith("/p/a%2Fb%3Fc?")).toBe(true);
  });
});
