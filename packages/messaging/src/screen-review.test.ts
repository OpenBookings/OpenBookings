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

  test("a number with a unit after an app name is not a handle", () => {
    const empty = { rules: [], fragments: [] };
    expect(screenReviewFragments("wifi signal 100mbps")).toEqual(empty);
    expect(screenReviewFragments("the wifi signal: 100%")).toEqual(empty);
    expect(screenReviewFragments("signal 2.5ghz in the room")).toEqual(empty);
    expect(screenReviewFragments("on telegram guest99").fragments).toEqual(["guest99"]);
  });

  test("an @handle needs a letter and isn't a time", () => {
    expect(screenReviewFragments("dinner @7pm was great")).toEqual({ rules: [], fragments: [] });
    expect(screenReviewFragments("breakfast @ 8 and @9am")).toEqual({ rules: [], fragments: [] });
    expect(screenReviewFragments("@hotelguest99").fragments).toEqual(["@hotelguest99"]);
  });

  test("only a known unit makes a number a measurement", () => {
    expect(screenReviewFragments("find me @123anna").fragments).toEqual(["@123anna"]);
    expect(screenReviewFragments("I'm @2cool").fragments).toEqual(["@2cool"]);
    expect(screenReviewFragments("insta: 007bond").fragments).toEqual(["007bond"]);
    const empty = { rules: [], fragments: [] };
    for (const text of ["wifi 100Mbps", "dinner @7PM", "on whatsapp 5min later", "insta: 20km away", "telegram 3gb used", "@10am"]) {
      expect(screenReviewFragments(text)).toEqual(empty);
    }
  });

  test("dates are not phone numbers", () => {
    const empty = { rules: [], fragments: [] };
    expect(screenReviewFragments("from 01.05.2025 to 05.05.2025")).toEqual(empty);
    expect(screenReviewFragments("from 01-05-2025 to 05-05-2025.")).toEqual(empty);
    expect(screenReviewFragments("from 1/5/2025 - 5/5/2025")).toEqual(empty);
    expect(screenReviewFragments("stayed 2025-05-01 until 2025-05-05")).toEqual(empty);
    expect(screenReviewFragments("call +31 6 12345678").fragments).toEqual(["+31 6 12345678"]);
    expect(screenReviewFragments("bel 06-12345678").fragments).toEqual(["06-12345678"]);
    expect(screenReviewFragments("on 01.05.2025 call 06-12345678").fragments).toEqual(["06-12345678"]);
    // Only years 1900-2099 make a yyyy-mm-dd date.
    expect(screenReviewFragments("call 0800-11-22").fragments).toEqual(["0800-11-22"]);
  });

  test("a link stops before punctuation that ends it", () => {
    expect(screenReviewFragments("hotelname.com/rooms,it is cheaper").fragments).toEqual(["hotelname.com/rooms"]);
    expect(screenReviewFragments("see https://example.com/a;b").fragments).toEqual(["https://example.com/a"]);
    expect(screenReviewFragments("(see https://example.com/rooms).").fragments).toEqual(["https://example.com/rooms"]);
    expect(screenReviewFragments("https://example.com/a.html?b=1 now").fragments).toEqual(["https://example.com/a.html?b=1"]);
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
