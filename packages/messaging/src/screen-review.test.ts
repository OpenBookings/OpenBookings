import { describe, expect, test } from "bun:test";
import { screenReview } from "./screen-review";

describe("screenReview", () => {
  test("lets ordinary reviews through", () => {
    expect(screenReview(null)).toBeNull();
    expect(screenReview("Great breakfast. The room was quiet, staff were kind. 9/10.")).toBeNull();
    expect(screenReview("Stayed two nights in room 12. Close to the station.")).toBeNull();
  });

  test("holds links back", () => {
    expect(screenReview("Book direct at https://example.com instead")).toBe("url");
    expect(screenReview("see www.example.nl")).toBe("url");
    expect(screenReview("cheaper on hotelname.com for sure")).toBe("url");
  });

  test("holds contact details back", () => {
    expect(screenReview("Call me on +31 6 1234 5678")).toBe("phone_number");
    expect(screenReview("mail anna@example.com")).toBe("email_address");
  });
});
