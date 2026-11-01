import { describe, expect, test } from "bun:test";
import {
  deleteAccountConfirmation,
  emailChangeConfirmation,
  newEmailVerification,
  passkeyAdded,
} from "./account-mail";

const URL = "https://openbookings.co/api/auth/verify-email?token=abc&callbackURL=%2F";

describe("account emails", () => {
  test("email change confirmation names the new address and links to the confirm url", () => {
    const mail = emailChangeConfirmation("new@example.com", URL);
    expect(mail.subject).toBe("Confirm your new email address");
    expect(mail.html).toContain("new@example.com");
    expect(mail.html).toContain(URL.replaceAll("&", "&amp;"));
  });

  test("new email verification links to the verify url", () => {
    const mail = newEmailVerification(URL);
    expect(mail.subject).toBe("Verify your email address");
    expect(mail.html).toContain(URL.replaceAll("&", "&amp;"));
  });

  test("delete confirmation links to the delete url", () => {
    const mail = deleteAccountConfirmation(URL);
    expect(mail.subject).toBe("Confirm you want to delete your account");
    expect(mail.html).toContain(URL.replaceAll("&", "&amp;"));
  });

  test("passkey added names the passkey and links to security", () => {
    const mail = passkeyAdded("iPhone", "https://openbookings.co/account/security");
    expect(mail.subject).toBe("A passkey was added to your account");
    expect(mail.html).toContain("iPhone");
    expect(mail.html).toContain("https://openbookings.co/account/security");
  });

  test("user-supplied text is escaped", () => {
    const mail = passkeyAdded('<img src=x onerror="alert(1)">', "https://openbookings.co/account/security");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  test("no template placeholder is left unfilled", () => {
    for (const mail of [
      emailChangeConfirmation("a@b.co", URL),
      newEmailVerification(URL),
      deleteAccountConfirmation(URL),
      passkeyAdded("Mac", URL),
    ]) {
      expect(mail.html).not.toMatch(/\{\{\w+\}\}/);
    }
  });
});
