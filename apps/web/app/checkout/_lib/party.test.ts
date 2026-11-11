import { describe, expect, test } from "bun:test";
import { partyFacts, payAtPropertyNote } from "./party";

describe("partyFacts", () => {
  test("adults, a child and an infant, with the age bands", () => {
    expect(partyFacts({ adults: 2, children: 1, infants: 1 })).toEqual(["2 adults", "1 child, 2–12", "1 infant, under 2"]);
  });
  test("zero counts are left out", () => {
    expect(partyFacts({ adults: 1, children: 0, infants: 0 })).toEqual(["1 adult"]);
  });
  test("plural children", () => {
    expect(partyFacts({ adults: 2, children: 2, infants: 0 })).toEqual(["2 adults", "2 children, 2–12"]);
  });
  test("plural infants", () => {
    expect(partyFacts({ adults: 2, children: 0, infants: 2 })).toEqual(["2 adults", "2 infants, under 2"]);
  });
});

describe("payAtPropertyNote", () => {
  const room = (payAtProperty: number, cots: number, extraBeds: number) => ({ payAtProperty, cots, extraBeds });
  test("nothing paid at the property: no note", () => {
    expect(payAtPropertyNote([room(0, 0, 0)])).toBeNull();
  });
  test("one extra bed", () => {
    expect(payAtPropertyNote([room(20, 0, 1)])).toBe(
      "The extra bed is paid at the property, so cancelling never costs you for it.",
    );
  });
  test("a cot", () => {
    expect(payAtPropertyNote([room(10, 1, 0)])).toBe(
      "The cot is paid at the property, so cancelling never costs you for it.",
    );
  });
  test("a cot and an extra bed", () => {
    expect(payAtPropertyNote([room(30, 1, 1)])).toBe(
      "The cot and extra bed are paid at the property, so cancelling never costs you for them.",
    );
  });
  test("two extra beds across rooms", () => {
    expect(payAtPropertyNote([room(20, 0, 1), room(20, 0, 1), room(0, 0, 0)])).toBe(
      "The extra beds are paid at the property, so cancelling never costs you for them.",
    );
  });
});
