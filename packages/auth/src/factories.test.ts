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

  // Better Auth's own freshness gate (default 1 day since sign-in) 403s
  // /list-sessions on the security pages for any session older than that.
  // Recency is enforced by the step-up gate instead (see step-up-hooks).
  test("both instances turn off Better Auth's session freshness gate", () => {
    const guest = createGuestAuth(base);
    const host = createHostAuth({ ...base, cookiePrefix: "ob-host" });
    expect(guest.options.session?.freshAge).toBe(0);
    expect(host.options.session?.freshAge).toBe(0);
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
    });

  test("google requires a verified email before issuing a session", () => {
    const providers = withProviders().options.socialProviders as Record<
      string,
      { requireEmailVerification?: boolean }
    >;
    expect(providers.google?.requireEmailVerification).toBe(true);
  });

  test("google is the only social provider on the host portal", () => {
    expect(Object.keys(withProviders().options.socialProviders ?? {})).toEqual(["google"]);
  });
});

describe("host admin plugin exposure", () => {
  const host = () => createHostAuth({ ...base, cookiePrefix: "ob-host" });

  test("the stock impersonation route is not reachable over HTTP", async () => {
    const res = await host().handler(
      new Request(`${base.baseURL}/api/auth/admin/impersonate-user`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base.baseURL },
        body: JSON.stringify({ userId: "someone" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test("it is still callable server-side, which is how impersonateWithAudit uses it", () => {
    expect(typeof host().api.impersonateUser).toBe("function");
    expect(host().options.disabledPaths).toEqual(["/admin/impersonate-user", "/organization/leave"]);
  });

  test("organization/leave is not reachable over HTTP", async () => {
    const res = await host().handler(
      new Request("http://business.localhost:3001/api/auth/organization/leave", {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          origin: "http://business.localhost:3001",
        },
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("host organization plugin", () => {
  test("hosts cannot create organizations through the plugin endpoint", () => {
    const host = createHostAuth({ ...base, cookiePrefix: "ob-host" });
    const org = host.options.plugins?.find((p) => p.id === "organization") as
      | { options?: { allowUserToCreateOrganization?: unknown } }
      | undefined;
    expect(org).toBeDefined();
    expect(org?.options?.allowUserToCreateOrganization).toBe(false);
  });
});
