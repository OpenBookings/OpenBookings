import { describe, expect, test } from "bun:test";
import { namesFromApple, namesFromGoogle, splitFullName } from "./names";

describe("splitFullName", () => {
  test("last token is the last name, the rest the first name", () => {
    expect(splitFullName("Anna de Vries")).toEqual({ firstName: "Anna de", lastName: "Vries" });
    expect(splitFullName("José María García")).toEqual({ firstName: "José María", lastName: "García" });
  });
  test("single token is a first name", () => {
    expect(splitFullName("Zoë")).toEqual({ firstName: "Zoë", lastName: "" });
  });
  test("trims, collapses whitespace and treats NBSP as whitespace", () => {
    expect(splitFullName("  Anna   de   Vries ")).toEqual({ firstName: "Anna de", lastName: "Vries" });
  });
  test("blank gives empty names", () => {
    expect(splitFullName("   ")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("namesFromGoogle", () => {
  test("given and family name are used as is", () => {
    expect(namesFromGoogle({ given_name: "Anna", family_name: "de Vries", name: "Anna de Vries" })).toEqual({
      firstName: "Anna",
      lastName: "de Vries",
    });
  });
  test("only a given name leaves the last name empty", () => {
    expect(namesFromGoogle({ given_name: " Zoë ", name: "Zoë" })).toEqual({ firstName: "Zoë", lastName: "" });
  });
  test("only name falls back to the split rule", () => {
    expect(namesFromGoogle({ name: "José María  García" })).toEqual({ firstName: "José María", lastName: "García" });
  });
  test("nothing usable means do not touch names", () => {
    expect(namesFromGoogle({})).toBeNull();
    expect(namesFromGoogle({ name: "  " })).toBeNull();
  });
  test("values are cut to 50 characters", () => {
    const r = namesFromGoogle({ given_name: "a".repeat(80), family_name: "b".repeat(80) });
    expect(r?.firstName).toHaveLength(50);
    expect(r?.lastName).toHaveLength(50);
  });
});

describe("namesFromApple", () => {
  test("first sign-in carries both names", () => {
    expect(namesFromApple({ name: { firstName: " Anna ", lastName: "de Vries" } })).toEqual({
      firstName: "Anna",
      lastName: "de Vries",
    });
  });
  test("later sign-ins carry no name: null, so stored names survive", () => {
    expect(namesFromApple(undefined)).toBeNull();
    expect(namesFromApple({})).toBeNull();
    expect(namesFromApple({ name: {} })).toBeNull();
    expect(namesFromApple({ name: { firstName: " ", lastName: "" } })).toBeNull();
  });
});
