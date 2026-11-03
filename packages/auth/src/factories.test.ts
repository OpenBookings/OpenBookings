import { describe, expect, test } from "bun:test";
import { createGuestAuth } from "./guest";
import { createHostAuth } from "./host";

// Constructing an instance never touches the database (pg pools connect
// lazily), so the factories can be exercised against a dead connection
// string.
const base = {
  baseURL: "http://app.localhost:3002",
  secret: "test-secret-test-secret-test-secret-1234",
  databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused",
  sendMagicLink: async () => {},
  cookiePrefix: "ob-guest",
};

describe("factory plugin surface", () => {
  test("guest instance mounts no organization endpoints", () => {
    const guest = createGuestAuth(base);
    expect("createOrganization" in guest.api).toBe(false);
    expect("listOrganizations" in guest.api).toBe(false);
  });

  test("host instance mounts organization endpoints", () => {
    const host = createHostAuth({ ...base, cookiePrefix: "ob-host" });
    expect("createOrganization" in host.api).toBe(true);
    expect("listOrganizations" in host.api).toBe(true);
  });

  test("both instances mount magic link", () => {
    const guest = createGuestAuth(base);
    const host = createHostAuth({ ...base, cookiePrefix: "ob-host" });
    expect("signInMagicLink" in guest.api).toBe(true);
    expect("signInMagicLink" in host.api).toBe(true);
  });

  test("admin endpoints exist only on the host instance", () => {
    const guest = createGuestAuth(base);
    const host = createHostAuth({ ...base, cookiePrefix: "ob-host" });
    expect("impersonateUser" in host.api).toBe(true);
    expect("setRole" in host.api).toBe(true);
    expect("impersonateUser" in guest.api).toBe(false);
    expect("setRole" in guest.api).toBe(false);
  });

  test("both instances mount passkeys; two-factor exists only on the host instance", () => {
    const guest = createGuestAuth(base);
    const host = createHostAuth({ ...base, cookiePrefix: "ob-host" });
    expect("generatePasskeyRegistrationOptions" in host.api).toBe(true);
    expect("verifyTOTP" in host.api).toBe(true);
    expect("generatePasskeyRegistrationOptions" in guest.api).toBe(true);
    expect("verifyTOTP" in guest.api).toBe(false);
  });

  test("guests can change their email and delete their account", () => {
    const guest = createGuestAuth(base);
    expect("changeEmail" in guest.api).toBe(true);
    expect("deleteUser" in guest.api).toBe(true);
    expect(guest.options.user?.changeEmail?.enabled).toBe(true);
    expect(guest.options.user?.deleteUser?.enabled).toBe(true);
    expect(typeof guest.options.user?.deleteUser?.sendDeleteAccountVerification).toBe("function");
  });

  // Asserted on the route table rather than through `guest.handler`: since
  // Better Auth 1.7 the handler validates the database schema before it
  // routes, so it cannot answer at all against a dead connection string.
  test("the guest instance routes no organization or admin paths", () => {
    const paths = (auth: { api: object }) =>
      Object.values(auth.api).map((endpoint) => (endpoint as { path?: string }).path ?? "");
    const guest = paths(createGuestAuth(base));
    const host = paths(createHostAuth({ ...base, cookiePrefix: "ob-host" }));
    expect(host).toContain("/organization/list");
    expect(guest.filter((path) => /^\/(organization|admin)\//.test(path))).toEqual([]);
  });
});

describe("host social providers", () => {
  const withProviders = () =>
    createHostAuth({
      ...base,
      cookiePrefix: "ob-host",
      googleClientId: "g-id",
      googleClientSecret: "g-secret",
      microsoftClientId: "m-id",
      microsoftClientSecret: "m-secret",
    });

  test("both require a verified email before issuing a session", () => {
    const providers = withProviders().options.socialProviders as Record<
      string,
      { requireEmailVerification?: boolean }
    >;
    expect(providers.microsoft?.requireEmailVerification).toBe(true);
    expect(providers.google?.requireEmailVerification).toBe(true);
  });

  test("an unverified Microsoft profile maps to no email, so the callback aborts", () => {
    const microsoft = (withProviders().options.socialProviders as Record<string, {
      mapProfileToUser?: (profile: Record<string, unknown>) => Record<string, unknown>;
    }>).microsoft;
    // Self-managed Entra tenant asserting a victim's address, no verification claim.
    const mapped = microsoft?.mapProfileToUser?.({
      email: "victim@example.com",
      email_verified: false,
      preferred_username: "victim@example.com",
      upn: "victim@example.com",
    });
    expect(mapped?.email).toBeUndefined();
    expect(mapped?.emailVerified).toBeUndefined();
  });
});
