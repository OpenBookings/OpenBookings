import { describe, expect, test } from "bun:test";
import { screenReview, screenReviewFragments } from "./screen-review";

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

describe("screenReviewFragments", () => {
  test("screenReviewFragments returns the matched phone number and URL", () => {
    const body = "Call +31 6 1234 5678. Or book direct at https://example.com/rooms, it is cheaper.";
    expect(screenReviewFragments(body)).toEqual({
      rules: ["links_contact"],
      fragments: ["+31 6 1234 5678", "https://example.com/rooms"],
    });
  });

  test("returns the email address and links, not the bare app name", () => {
    const r = screenReviewFragments("Mail anna@example.com or whatsapp me, or see www.example.nl and hotelname.com today");
    expect(r.rules).toEqual(["links_contact"]);
    expect(r.fragments.sort()).toEqual(["anna@example.com", "hotelname.com", "www.example.nl"]);
  });

  test("everyday words that name an app are not contact details", () => {
    const empty = { rules: [], fragments: [] };
    expect(screenReviewFragments("the wifi signal was weak")).toEqual(empty);
    expect(screenReviewFragments("we snapped photos")).toEqual(empty);
    expect(screenReviewFragments("Staff told us to snap a photo, found them on telegram too.")).toEqual(empty);
    expect(screenReviewFragments("I am on instagram yesterday and today")).toEqual(empty);
  });

  test("a handle or a number with an app name is flagged by the handle or number", () => {
    expect(screenReviewFragments("add me on telegram @hotelguest99")).toEqual({
      rules: ["links_contact"],
      fragments: ["@hotelguest99"],
    });
    expect(screenReviewFragments("call +31 6 12345678")).toEqual({
      rules: ["links_contact"],
      fragments: ["+31 6 12345678"],
    });
    expect(screenReviewFragments("follow us on insta: hotel_guest99.")).toEqual({
      rules: ["links_contact"],
      fragments: ["hotel_guest99"],
    });
    expect(screenReviewFragments("Find me @anna.b. Great stay!").fragments).toEqual(["@anna.b"]);
  });

  test("returns nothing for an ordinary review or no text", () => {
    expect(screenReviewFragments("Great breakfast. Stayed two nights in room 12.")).toEqual({ rules: [], fragments: [] });
    expect(screenReviewFragments(null)).toEqual({ rules: [], fragments: [] });
  });

  test("every fragment is a substring of the text", () => {
    const body = "Ring (020) 123-4567 or +32 470 12 34 56 - anna.b@example.org, http://x.example.eu/a?b=1!";
    const r = screenReviewFragments(body);
    expect(r.fragments.length).toBeGreaterThan(0);
    for (const f of r.fragments) expect(body.includes(f)).toBe(true);
  });
});
