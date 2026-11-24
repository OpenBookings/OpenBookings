import { describe, expect, test } from "bun:test";
import { userInitials } from "./initials";

describe("userInitials", () => {
  test("first letter of the first name and of the last name", () => {
    expect(userInitials({ firstName: "Anna de", lastName: "Vries", name: "Anna de Vries" })).toBe("AV");
    expect(userInitials({ firstName: "zoë", lastName: "garcía" })).toBe("ZG");
  });

  test("a single name gives one letter", () => {
    expect(userInitials({ firstName: "Zoë", lastName: "", name: "Zoë" })).toBe("Z");
  });

  test("a session without the new fields falls back to the full name", () => {
    expect(userInitials({ name: "Anna de Vries" })).toBe("AD");
    expect(userInitials({ firstName: "", lastName: "", name: "Anna Vries" })).toBe("AV");
  });

  test("no name at all gives a question mark", () => {
    expect(userInitials({ firstName: "", lastName: "", name: "" })).toBe("?");
    expect(userInitials({})).toBe("?");
    expect(userInitials({ name: null, firstName: null, lastName: null })).toBe("?");
  });
});
