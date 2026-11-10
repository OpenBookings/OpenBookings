import { describe, expect, test } from "bun:test";
import {
  DETAILS_SAVE_FAILED,
  OFFLINE,
  describeConfirmError,
  describeValidationError,
  unexpectedPaymentError,
  alertForConfirmError,
} from "./errors";

describe("describeConfirmError", () => {
  test("a known decline gets our words, and is not paged as a bug", () => {
    const described = describeConfirmError({
      code: "paymentFailed",
      message: "Your card has insufficient funds.",
      paymentFailed: { declineCode: "insufficient_funds" },
    });
    expect(described.message).toContain("isn't enough money on that card");
    expect(described.report).toBe(false);
  });

  test("fraud signals read as an ordinary decline", () => {
    const described = describeConfirmError({ code: "paymentFailed", paymentFailed: { declineCode: "stolen_card" } });
    expect(described.message).not.toMatch(/stolen|fraud/i);
  });

  test("a decline code we have no words for is reported with its code", () => {
    const described = describeConfirmError({ code: "paymentFailed", paymentFailed: { declineCode: "brand_new_code" } });
    expect(described.unmappedCode).toBe("brand_new_code");
    expect(described.report).toBe(true);
  });

  test("other failures keep Stripe.js's buyer-facing message and are reported", () => {
    const described = describeConfirmError({ code: null, message: "Your postal code is incomplete." });
    expect(described.message).toBe("Your postal code is incomplete.");
    expect(described.report).toBe(true);
  });

  test("an empty failure still says something, without promising nothing was charged", () => {
    const described = describeConfirmError({ code: null, message: "  " });
    expect(described.message.length).toBeGreaterThan(0);
    expect(described.message).not.toMatch(/no charge|nothing has been charged/i);
  });
});

describe("describeValidationError", () => {
  test("uses Stripe's sentence for a single incomplete field", () => {
    expect(
      describeValidationError({ validation_errors: [{ element: "payment", message: "Your card number is incomplete." }] }),
    ).toBe("Your card number is incomplete.");
  });

  test("names the element when Stripe gives no sentence", () => {
    expect(describeValidationError({ validation_errors: [{ element: "payment" }] })).toBe(
      "Please complete your payment details and try again.",
    );
  });

  test("several incomplete fields get one line", () => {
    expect(describeValidationError({ validation_errors: [{ element: "payment" }, { element: "payment" }] })).toBe(
      "Please complete the highlighted fields above and try again.",
    );
  });
});

describe("copy", () => {
  test("a failed save of the details says nothing was charged, because confirm never ran", () => {
    expect(DETAILS_SAVE_FAILED).toEqual({
      message: "We couldn't save your details. Nothing has been charged — please try again.",
      retryable: true,
    });
  });

  test("offline copy is unchanged", () => {
    expect(OFFLINE.message).toBe("You appear to be offline. Reconnect and try again — nothing has been charged.");
  });
});

describe("unexpectedPaymentError", () => {
  test("before Stripe was asked to charge, nothing was charged and it may say so", () => {
    expect(unexpectedPaymentError({ confirmStarted: false, offline: false })).toMatch(/nothing has been charged/i);
    expect(unexpectedPaymentError({ confirmStarted: false, offline: true })).toBe(OFFLINE.message);
  });

  test("once Stripe was asked to charge, it never claims nothing was charged", () => {
    for (const offline of [false, true]) {
      const message = unexpectedPaymentError({ confirmStarted: true, offline });
      expect(message).not.toMatch(/nothing has been charged|no charge/i);
      expect(message).toMatch(/check your email/i);
    }
  });
});

describe("alertForConfirmError", () => {
  const decline = { code: "paymentFailed", paymentFailed: { declineCode: "insufficient_funds" } };

  test("a card decline is left to Stripe's own line under the card field", () => {
    expect(alertForConfirmError(decline, { elementShowsDeclines: true }).message).toBeNull();
  });

  test("a wallet decline has no field to show it, so our line says it", () => {
    expect(alertForConfirmError(decline, { elementShowsDeclines: false }).message).toContain("isn't enough money");
  });

  test("a decline code we have no words for is still reported, even when Stripe shows it", () => {
    const described = alertForConfirmError(
      { code: "paymentFailed", paymentFailed: { declineCode: "brand_new_code" } },
      { elementShowsDeclines: true },
    );
    expect(described.report).toBe(true);
    expect(described.unmappedCode).toBe("brand_new_code");
  });

  test("other failures always get our line", () => {
    expect(alertForConfirmError({ code: null, message: "Something odd." }, { elementShowsDeclines: true }).message).toBe("Something odd.");
  });
});
