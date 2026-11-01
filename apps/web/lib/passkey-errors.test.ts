import { describe, expect, test } from "bun:test";
import { isPasskeyPromptCancelled, passkeyErrorMessage } from "./passkey-errors";

describe("passkeyErrorMessage", () => {
  test("a dismissed or timed-out device prompt reads as a cancellation, not a browser error", () => {
    for (const code of ["ERROR_CEREMONY_ABORTED", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"]) {
      expect(
        passkeyErrorMessage({ code, message: "The operation either timed out or was not allowed." }, "fallback"),
      ).toBe("The passkey prompt was cancelled or timed out. Nothing was changed.");
    }
  });

  test("a device that already holds a passkey says so", () => {
    expect(
      passkeyErrorMessage({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED", message: "Previously registered" }, "fallback"),
    ).toBe("This device already has a passkey for your account.");
  });

  test("a message written by the server is shown as it is", () => {
    const message =
      "Your organization requires a passkey on every account. Add another passkey before deleting this one.";
    expect(passkeyErrorMessage({ message }, "fallback")).toBe(message);
  });

  test("an error with nothing to say falls back", () => {
    expect(passkeyErrorMessage({}, "Could not remove the passkey.")).toBe("Could not remove the passkey.");
    expect(passkeyErrorMessage(null, "Could not remove the passkey.")).toBe("Could not remove the passkey.");
  });
});

describe("isPasskeyPromptCancelled", () => {
  test("a dismissed or timed-out prompt is a cancellation", () => {
    expect(isPasskeyPromptCancelled({ code: "ERROR_CEREMONY_ABORTED" })).toBe(true);
    expect(isPasskeyPromptCancelled({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" })).toBe(true);
  });

  test("anything else is a real failure", () => {
    expect(isPasskeyPromptCancelled({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })).toBe(false);
    expect(isPasskeyPromptCancelled({ message: "Server said no" })).toBe(false);
    expect(isPasskeyPromptCancelled(null)).toBe(false);
  });
});
