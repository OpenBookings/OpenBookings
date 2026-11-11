import { describe, expect, test } from "bun:test";
import { ruleForm, ruleSentence, type PricingRule } from "./rule-copy";

const rule = (over: Partial<PricingRule>): PricingRule => ({
  id: "r1",
  type: "day_of_week",
  adjustmentType: "flat",
  adjustmentValue: 30,
  triggerCondition: { days_of_week: [5, 6] },
  active: true,
  ...over,
});

describe("ruleSentence", () => {
  test("each rule reads as a sentence, fixed amounts per night", () => {
    expect(ruleSentence(rule({}))).toBe("Fri, Sat: +€30 per night");
    expect(ruleSentence(rule({ adjustmentType: "percent", adjustmentValue: -10, triggerCondition: { days_of_week: [0] } }))).toBe(
      "Sun: −10%",
    );
    expect(ruleSentence(rule({ type: "length_of_stay", adjustmentType: "percent", adjustmentValue: -10, triggerCondition: { min_nights: 7 } }))).toBe(
      "Stays of 7+ nights: −10%",
    );
    expect(ruleSentence(rule({ type: "early_bird", adjustmentType: "percent", adjustmentValue: -15, triggerCondition: { days_before_arrival: 60 } }))).toBe(
      "Booked 60+ days ahead: −15%",
    );
    expect(ruleSentence(rule({ type: "last_minute", adjustmentValue: 20, triggerCondition: { days_till_arrival: 3 } }))).toBe(
      "Booked within 3 days of arrival: +€20 per night",
    );
    expect(ruleSentence(rule({ type: "last_minute", adjustmentType: "percent", adjustmentValue: -10, triggerCondition: { days_till_arrival: 0 } }))).toBe(
      "Booked on the day of arrival: −10%",
    );
  });

  test("weekdays are listed Monday first", () => {
    expect(ruleSentence(rule({ triggerCondition: { days_of_week: [0, 1, 6] } }))).toBe("Mon, Sat, Sun: +€30 per night");
  });
});

describe("ruleForm", () => {
  test("a saved rule opens in the editor as the host entered it", () => {
    expect(ruleForm(rule({}))).toEqual({
      kind: "weekend",
      direction: "up",
      adjustmentType: "flat",
      amount: "30",
      daysOfWeek: ["5", "6"],
      minNights: "",
      daysBeforeArrival: "",
      daysTillArrival: "",
    });
    expect(ruleForm(rule({ type: "length_of_stay", adjustmentType: "percent", adjustmentValue: -10, triggerCondition: { min_nights: 7 } }))).toMatchObject({
      kind: "length_of_stay",
      direction: "down",
      amount: "10",
      minNights: "7",
    });
  });

  test("a new rule starts as a weekend surcharge on Friday and Saturday", () => {
    expect(ruleForm(null)).toMatchObject({ kind: "weekend", direction: "up", adjustmentType: "percent", daysOfWeek: ["5", "6"] });
  });
});
