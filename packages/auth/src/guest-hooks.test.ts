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
      const refusal = passkeyRegistrationRefusal(path, stale, NOW);
      expect(refusal?.code).toBe("REAUTH_REQUIRED");
      expect(refusal?.message).toBe("For your security, sign in again to add a passkey.");
    }
  });

  test("lets a fresh session register, and ignores every other path", () => {
    expect(passkeyRegistrationRefusal("/passkey/verify-registration", "2026-11-01T10:00:00Z", NOW)).toBeNull();
    expect(passkeyRegistrationRefusal("/passkey/delete-passkey", stale, NOW)).toBeNull();
    expect(passkeyRegistrationRefusal("/list-sessions", stale, NOW)).toBeNull();
  });
});
