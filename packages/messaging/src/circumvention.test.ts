import { describe, expect, test } from "bun:test";
import { detectCircumvention } from "./circumvention";

describe("detectCircumvention", () => {
  test("clean message is not flagged", () => {
    expect(detectCircumvention("Looking forward to check-in on Friday!")).toBeNull();
  });

  test("phone number is flagged", () => {
    expect(detectCircumvention("Call me at +1 (555) 123-4567")).toBe("phone_number");
    expect(detectCircumvention("My number is 555-123-4567")).toBe("phone_number");
  });

  test("email address is flagged", () => {
    expect(detectCircumvention("Reach me at guest@example.com instead")).toBe("email_address");
  });

  test("messenger handle keyword is flagged", () => {
    expect(detectCircumvention("Message me on WhatsApp")).toBe("messenger_handle");
    expect(detectCircumvention("add me on telegram")).toBe("messenger_handle");
    expect(detectCircumvention("find me on instagram")).toBe("messenger_handle");
  });

  test("multiple violations are comma-joined in detection order", () => {
    expect(
      detectCircumvention("Call 555-123-4567 or email guest@example.com, or whatsapp me"),
    ).toBe("phone_number,email_address,messenger_handle");
  });

  test("short digit sequences are not flagged as a phone number", () => {
    expect(detectCircumvention("Booking ref: 12345")).toBeNull();
  });

  test("ordinary prose with small numbers is not flagged", () => {
    expect(detectCircumvention("See you at 10, room 2 is on the 3rd floor")).toBeNull();
  });
});
