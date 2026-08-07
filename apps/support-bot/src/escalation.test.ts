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
  // Each language gets both directions: real dispute language must escalate,
  // and that language's ordinary complaint/cancellation/refund vocabulary
  // must not — a false positive dumps a routine question on a human.
  const DISPUTES: Record<string, string[]> = {
    EN: [
      "I will open a dispute with my card issuer",
      "I've started a chargeback",
      "I am disputing this charge",
      "My bank will reverse the payment",
      "I'm going to contact my bank about this",
      "Please stop payment on that transaction",
    ],
    NL: [
      "ik start een terugboeking",
      "ik laat het bedrag terugboeken via de bank",
      "dit is een geschil",
      "mijn bank gaat het geld terughalen",
      "ik ga het bedrag terugvorderen",
    ],
    DE: [
      "ich veranlasse eine Rückbuchung",
      "ich werde den Betrag zurückbuchen lassen",
      "das ist ein Streitfall",
      "ich lasse die Lastschrift zurückgeben",
      "ich werde die Zahlung anfechten",
    ],
    FR: [
      "je vais demander une rétrofacturation",
      "il s'agit d'un litige",
      "je vais faire opposition",
      "je vais contester ce paiement",
      "ma banque va me rembourser directement",
    ],
  };

  const NEUTRAL: Record<string, string[]> = {
    EN: [
      "Can I get a refund if I cancel tomorrow?",
      "What time is check-in?",
      "The room was dirty and I want to complain",
      "I'd like to cancel my booking please",
    ],
    NL: [
      "Kan ik mijn boeking annuleren?",
      "Ik wil een klacht indienen over de kamer",
      "Krijg ik mijn geld terug als ik annuleer?",
    ],
    DE: [
      // "stornieren" is German for cancelling a booking — it must never be
      // confused with Dutch "storneren" (reversing a direct debit).
      "Kann ich meine Buchung stornieren?",
      "Ich möchte eine Stornierung vornehmen",
      "Das Zimmer war schmutzig, ich möchte mich beschweren",
    ],
    FR: [
      "Puis-je annuler ma réservation ?",
      "Je voudrais faire une réclamation sur la chambre",
      "Est-ce que je serai remboursé si j'annule ?",
    ],
  };

  for (const [language, messages] of Object.entries(DISPUTES)) {
    it(`escalates dispute/chargeback language in ${language}`, () => {
      for (const message of messages) {
        expect(messageTriggersEscalation(message), message).not.toBeNull();
      }
    });
  }

  for (const [language, messages] of Object.entries(NEUTRAL)) {
    it(`leaves ordinary ${language} complaints and refund questions to the bot`, () => {
      for (const message of messages) {
        expect(messageTriggersEscalation(message), message).toBeNull();
      }
    });
  }

  it("matches regardless of diacritics or case", () => {
    expect(messageTriggersEscalation("ich veranlasse eine RUECKBUCHUNG")).not.toBeNull();
    expect(messageTriggersEscalation("ich veranlasse eine ruckbuchung")).not.toBeNull();
    expect(messageTriggersEscalation("une retrofacturation svp")).not.toBeNull();
  });

  it("names the matched phrase so the human agent sees why", () => {
    expect(messageTriggersEscalation("I've started a chargeback")).toContain("chargeback");
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

  it("fires exactly at the threshold, not a cent below", () => {
    // Threshold is euros; refund amounts are cents. €250 → 25000 cents.
    expect(paymentTriggersEscalation(summary({ amountRefunded: 24999 }), 250)).toBeNull();
    expect(paymentTriggersEscalation(summary({ amountRefunded: 25000 }), 250)).not.toBeNull();

    // Same boundary via a single refund rather than the charge total.
    const withRefund = (amount: number) =>
      summary({
        refunds: [
          { id: "re_1", status: "succeeded", amount, currency: "eur", reason: null, created: "" },
        ],
      });
    expect(paymentTriggersEscalation(withRefund(24999), 250)).toBeNull();
    expect(paymentTriggersEscalation(withRefund(25000), 250)).not.toBeNull();
  });

  it("handles a fractional euro threshold without float drift", () => {
    expect(paymentTriggersEscalation(summary({ amountRefunded: 12549 }), 125.5)).toBeNull();
    expect(paymentTriggersEscalation(summary({ amountRefunded: 12550 }), 125.5)).not.toBeNull();
  });
});
