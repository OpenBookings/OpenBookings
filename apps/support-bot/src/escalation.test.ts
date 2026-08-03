import { describe, expect, it } from "bun:test";
import type { PaymentSummary } from "@openbookings/stripe";
import { messageTriggersEscalation, paymentTriggersEscalation } from "./escalation";

function summary(overrides: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    paymentIntentId: "pi_123",
    status: "succeeded",
    amount: 40000,
    currency: "eur",
    amountRefunded: 0,
    fullyRefunded: false,
    disputed: false,
    refunds: [],
    ...overrides,
  };
}

describe("messageTriggersEscalation", () => {
  it("flags dispute/chargeback language", () => {
    expect(messageTriggersEscalation("I will open a dispute with my card issuer")).not.toBeNull();
    expect(messageTriggersEscalation("I've started a chargeback")).not.toBeNull();
    expect(messageTriggersEscalation("ik start een terugboeking")).not.toBeNull();
  });

  it("leaves ordinary refund questions to the bot", () => {
    expect(messageTriggersEscalation("Can I get a refund if I cancel tomorrow?")).toBeNull();
    expect(messageTriggersEscalation("What time is check-in?")).toBeNull();
  });
});

describe("paymentTriggersEscalation", () => {
  it("escalates a disputed charge regardless of amount", () => {
    expect(paymentTriggersEscalation(summary({ disputed: true }), 250)).not.toBeNull();
  });

  it("escalates refund activity at/above the threshold", () => {
    expect(paymentTriggersEscalation(summary({ amountRefunded: 25000 }), 250)).not.toBeNull();
    expect(
      paymentTriggersEscalation(
        summary({
          refunds: [
            { id: "re_1", status: "pending", amount: 30000, currency: "eur", reason: null, created: "" },
          ],
        }),
        250,
      ),
    ).not.toBeNull();
  });

  it("does not escalate small refunds or clean payments", () => {
    expect(paymentTriggersEscalation(summary(), 250)).toBeNull();
    expect(paymentTriggersEscalation(summary({ amountRefunded: 5000 }), 250)).toBeNull();
  });
});
