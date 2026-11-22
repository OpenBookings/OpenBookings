import { describe, expect, test } from "bun:test";
import { PASSKEY_SESSION_MAX_AGE_MS, isSessionFreshForPasskey, passkeyRegistrationRefusal } from "./guest-hooks";

const NOW = new Date("2026-11-01T12:00:00Z");

describe("isSessionFreshForPasskey", () => {
  test("a sign-in within the last 24 hours is fresh", () => {
    expect(PASSKEY_SESSION_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(isSessionFreshForPasskey(new Date("2026-11-01T11:59:00Z"), NOW)).toBe(true);
    expect(isSessionFreshForPasskey("2026-10-31T12:00:01Z", NOW)).toBe(true);
  });

  test("older than 24 hours, missing or unreadable is not", () => {
    expect(isSessionFreshForPasskey("2026-10-31T12:00:00Z", NOW)).toBe(false);
    expect(isSessionFreshForPasskey(null, NOW)).toBe(false);
    expect(isSessionFreshForPasskey("not a date", NOW)).toBe(false);
  });
});

describe("passkeyRegistrationRefusal", () => {
  const stale = "2026-10-01T00:00:00Z";

  test("refuses both registration steps on a stale session", () => {
    for (const path of ["/passkey/generate-register-options", "/passkey/verify-registration"]) {
      const refusal = passkeyRegistrationRefusal(path, { createdAt: stale, emailVerified: true }, NOW);
      expect(refusal?.code).toBe("REAUTH_REQUIRED");
      expect(refusal?.message).toBe("For your security, sign in again to add a passkey.");
    }
  });

  test("lets a fresh session register, and ignores every other path", () => {
    expect(passkeyRegistrationRefusal("/passkey/verify-registration", { createdAt: "2026-11-01T10:00:00Z", emailVerified: true }, NOW)).toBeNull();
    expect(passkeyRegistrationRefusal("/passkey/delete-passkey", { createdAt: stale, emailVerified: true }, NOW)).toBeNull();
    expect(passkeyRegistrationRefusal("/list-sessions", { createdAt: stale, emailVerified: true }, NOW)).toBeNull();
  });
});

describe("passkey registration needs a verified email (GHSA-gv93-27wp-8wff)", () => {
  const fresh = "2026-11-01T10:00:00Z";

  test("refuses both registration steps while the email is unverified, even on a fresh session", () => {
    for (const path of ["/passkey/generate-register-options", "/passkey/verify-registration"]) {
      const refusal = passkeyRegistrationRefusal(path, { createdAt: fresh, emailVerified: false }, NOW);
      expect(refusal?.code).toBe("EMAIL_NOT_VERIFIED");
    }
  });

  test("a verified email on a fresh session may register", () => {
    expect(
      passkeyRegistrationRefusal("/passkey/generate-register-options", { createdAt: fresh, emailVerified: true }, NOW),
    ).toBeNull();
  });

  test("every other path is left alone", () => {
    expect(passkeyRegistrationRefusal("/passkey/delete-passkey", { createdAt: fresh, emailVerified: false }, NOW)).toBeNull();
  });
});
