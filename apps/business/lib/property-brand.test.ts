import { describe, expect, test } from "bun:test";
import { toPropertyBrand } from "./property-brand";

describe("toPropertyBrand", () => {
  test("maps a property row with a logo", () => {
    expect(toPropertyBrand({ name: "Hotel Zeezicht", logo_url: "https://cdn.openbookings.co/uploads/a.png" })).toEqual({
      name: "Hotel Zeezicht",
      logoUrl: "https://cdn.openbookings.co/uploads/a.png",
    });
  });

  test("a property without a logo row still yields a brand", () => {
    expect(toPropertyBrand({ name: "Hotel Zeezicht", logo_url: null })).toEqual({
      name: "Hotel Zeezicht",
      logoUrl: null,
    });
  });

  test("no property row means no brand", () => {
    expect(toPropertyBrand(null)).toBeNull();
  });

  test("a blank logo url is the same as none, not an empty <img> src", () => {
    expect(toPropertyBrand({ name: "Hotel Zeezicht", logo_url: "   " })?.logoUrl).toBeNull();
  });

  test("a nameless property is not a brand worth rendering", () => {
    expect(toPropertyBrand({ name: "  ", logo_url: "https://cdn.openbookings.co/uploads/a.png" })).toBeNull();
  });

  test("trims the stored name so the header does not render padding", () => {
    expect(toPropertyBrand({ name: "  Hotel Zeezicht ", logo_url: null })?.name).toBe("Hotel Zeezicht");
  });
});
