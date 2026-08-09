import { describe, expect, test } from "bun:test";
import {
  accountTypeMismatchMessage,
  advancedCookieConfig,
  buildAccountTypeHooks,
  isAccountTypeAllowed,
  microsoftEmailFromProfile,
  portalForAccountType,
  sessionCookieNames,
  sessionForApp,
  stampMicrosoftTenantId,
} from "./server";

// These hooks are what Better Auth runs on every sign-in path — password,
// magic link, and OAuth callbacks all go through session.create — so
// exercising them directly covers cross-app rejection for all three methods.

const makeUser = (overrides: Record<string, unknown> = {}) =>
  ({ id: "u1", email: "a@b.co", name: "A", ...overrides }) as never;

const makeSession = (userId = "u1") => ({ id: "s1", userId }) as never;

describe("isAccountTypeAllowed", () => {
  test("matching type is allowed", () => {
    expect(isAccountTypeAllowed("private", "private")).toBe(true);
    expect(isAccountTypeAllowed("business", "business")).toBe(true);
  });

  test("cross-app type is rejected", () => {
    expect(isAccountTypeAllowed("private", "business")).toBe(false);
    expect(isAccountTypeAllowed("business", "private")).toBe(false);
  });

  test("missing account_type is rejected, never defaulted", () => {
    expect(isAccountTypeAllowed("private", null)).toBe(false);
    expect(isAccountTypeAllowed("private", undefined)).toBe(false);
    expect(isAccountTypeAllowed("business", null)).toBe(false);
  });
});

describe("user.create.before (account_type stamping)", () => {
  test("web app stamps private on signup", async () => {
    const hooks = buildAccountTypeHooks("private", async () => null);
    const result = await hooks.user.create.before(makeUser());
    expect((result.data as Record<string, unknown>).account_type).toBe("private");
  });

  test("business app stamps business on signup", async () => {
    const hooks = buildAccountTypeHooks("business", async () => null);
    const result = await hooks.user.create.before(makeUser());
    expect((result.data as Record<string, unknown>).account_type).toBe("business");
  });

  test("stamp overrides any client-supplied account_type", async () => {
    const hooks = buildAccountTypeHooks("private", async () => null);
    const result = await hooks.user.create.before(
      makeUser({ account_type: "business" }),
    );
    expect((result.data as Record<string, unknown>).account_type).toBe("private");
  });
});

describe("session.create.before (cross-app sign-in rejection)", () => {
  test("business account is rejected on web", async () => {
    const hooks = buildAccountTypeHooks("private", async () => "business");
    await expect(hooks.session.create.before(makeSession())).rejects.toThrow(
      /business\.openbookings\.co/,
    );
  });

  test("private account is rejected on business", async () => {
    const hooks = buildAccountTypeHooks("business", async () => "private");
    await expect(hooks.session.create.before(makeSession())).rejects.toThrow(
      /openbookings\.co/,
    );
  });

  test("unknown user is rejected", async () => {
    const hooks = buildAccountTypeHooks("private", async () => null);
    await expect(hooks.session.create.before(makeSession())).rejects.toThrow();
  });

  test("matching account signs in on web", async () => {
    const hooks = buildAccountTypeHooks("private", async () => "private");
    await expect(hooks.session.create.before(makeSession())).resolves.toMatchObject({
      data: { portal: "guest" },
    });
  });

  test("matching account signs in on business", async () => {
    const hooks = buildAccountTypeHooks("business", async () => "business");
    await expect(hooks.session.create.before(makeSession())).resolves.toMatchObject({
      data: { portal: "host" },
    });
  });

  test("lookup uses the session's userId", async () => {
    let asked: string | undefined;
    const hooks = buildAccountTypeHooks("private", async (id) => {
      asked = id;
      return "private";
    });
    await hooks.session.create.before(makeSession("user-42"));
    expect(asked).toBe("user-42");
  });
});

describe("session.create.before (portal stamping)", () => {
  test("business sessions are stamped host", async () => {
    const hooks = buildAccountTypeHooks("business", async () => "business");
    const result = await hooks.session.create.before(makeSession());
    expect((result?.data as Record<string, unknown>).portal).toBe("host");
  });

  test("private sessions are stamped guest", async () => {
    const hooks = buildAccountTypeHooks("private", async () => "private");
    const result = await hooks.session.create.before(makeSession());
    expect((result?.data as Record<string, unknown>).portal).toBe("guest");
  });
});

describe("sessionForApp (per-request re-check)", () => {
  const make = (account_type: string | null, portal?: string | null) => ({
    user: { id: "u1", account_type },
    session: { id: "s1", portal },
  });

  test("null/undefined session resolves to null", () => {
    expect(sessionForApp(null, "business")).toBeNull();
    expect(sessionForApp(undefined, "business")).toBeNull();
  });

  test("guest session presented to the business app is rejected", () => {
    expect(sessionForApp(make("private", "guest"), "business")).toBeNull();
  });

  test("business session presented to the web app is rejected", () => {
    expect(sessionForApp(make("business", "host"), "private")).toBeNull();
  });

  test("missing account_type is rejected, never defaulted", () => {
    expect(sessionForApp(make(null, "host"), "business")).toBeNull();
  });

  test("portal stamp from the other app is rejected even if account_type matches", () => {
    expect(sessionForApp(make("business", "guest"), "business")).toBeNull();
  });

  test("legacy session without portal passes on account_type alone", () => {
    expect(sessionForApp(make("business", null), "business")).not.toBeNull();
    expect(sessionForApp(make("business", undefined), "business")).not.toBeNull();
  });

  test("matching session passes through unchanged", () => {
    const s = make("private", "guest");
    expect(sessionForApp(s, "private")).toBe(s);
  });
});

describe("portalForAccountType", () => {
  test("maps account types to portals", () => {
    expect(portalForAccountType("business")).toBe("host");
    expect(portalForAccountType("private")).toBe("guest");
    expect(portalForAccountType("unknown")).toBeUndefined();
  });
});

describe("cookie isolation", () => {
  test("dev cookies are prefix-scoped without __Host-", () => {
    expect(sessionCookieNames("ob-host", false)).toContain(
      "ob-host.session_token",
    );
  });

  test("production cookies carry the __Host- prefix", () => {
    expect(sessionCookieNames("ob-host", true)).toContain(
      "__Host-ob-host.session_token",
    );
  });

  test("guest and host cookie names never overlap", () => {
    for (const secure of [true, false]) {
      const guest = new Set(sessionCookieNames("ob-guest", secure));
      for (const name of sessionCookieNames("ob-host", secure)) {
        expect(guest.has(name)).toBe(false);
      }
    }
  });

  test("cross-subdomain cookies are disabled in every mode", () => {
    expect(advancedCookieConfig("ob-host", false).crossSubDomainCookies.enabled).toBe(false);
    expect(advancedCookieConfig("ob-host", true).crossSubDomainCookies.enabled).toBe(false);
  });

  test("production config names core cookies __Host- and disables the __Secure- auto-prefix", () => {
    const config = advancedCookieConfig("ob-host", true);
    expect(config.useSecureCookies).toBe(false);
    expect(config.cookies?.session_token.name).toBe("__Host-ob-host.session_token");
    expect(config.cookies?.session_token.attributes.secure).toBe(true);
    expect(config.defaultCookieAttributes?.secure).toBe(true);
  });

  test("dev config sets no domain and no __Host- names", () => {
    const config = advancedCookieConfig("ob-guest", false);
    expect(config).toEqual({
      cookiePrefix: "ob-guest",
      crossSubDomainCookies: { enabled: false },
    });
  });
});

describe("user.create.before (email collision)", () => {
  test("existing email is rejected with the friendly collision message", async () => {
    const hooks = buildAccountTypeHooks(
      "business",
      async () => null,
      async () => "existing-user-id",
    );
    await expect(hooks.user.create.before(makeUser())).rejects.toThrow(
      /already registered as a guest account/,
    );
  });

  test("guest signup with a host email gets the inverse message", async () => {
    const hooks = buildAccountTypeHooks(
      "private",
      async () => null,
      async () => "existing-user-id",
    );
    await expect(hooks.user.create.before(makeUser())).rejects.toThrow(
      /already registered as a host account/,
    );
  });

  test("fresh email passes and is stamped", async () => {
    const hooks = buildAccountTypeHooks(
      "business",
      async () => null,
      async () => null,
    );
    const result = await hooks.user.create.before(makeUser());
    expect((result.data as Record<string, unknown>).account_type).toBe("business");
  });
});

describe("microsoftEmailFromProfile", () => {
  test("prefers the email claim", () => {
    expect(
      microsoftEmailFromProfile({
        email: "a@b.co",
        preferred_username: "other@c.co",
      }),
    ).toBe("a@b.co");
  });

  test("falls back to email-shaped preferred_username, then upn", () => {
    expect(
      microsoftEmailFromProfile({ preferred_username: "user@tenant.co" }),
    ).toBe("user@tenant.co");
    expect(microsoftEmailFromProfile({ upn: "user@tenant.co" })).toBe(
      "user@tenant.co",
    );
  });

  test("never returns a non-email UPN or phone", () => {
    expect(
      microsoftEmailFromProfile({ preferred_username: "+31612345678" }),
    ).toBeUndefined();
    expect(microsoftEmailFromProfile({ upn: "PHONE#user" })).toBeUndefined();
    expect(microsoftEmailFromProfile({})).toBeUndefined();
  });
});

describe("stampMicrosoftTenantId", () => {
  const fakeIdToken = (payload: Record<string, unknown>) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

  test("stamps tenant_id from the tid claim on microsoft accounts", () => {
    const result = stampMicrosoftTenantId({
      providerId: "microsoft",
      idToken: fakeIdToken({ tid: "tenant-123" }),
    });
    expect(result?.data.tenant_id).toBe("tenant-123");
  });

  test("leaves other providers untouched", () => {
    expect(
      stampMicrosoftTenantId({
        providerId: "google",
        idToken: fakeIdToken({ tid: "nope" }),
      }),
    ).toBeUndefined();
  });

  test("tolerates missing or malformed id tokens", () => {
    expect(
      stampMicrosoftTenantId({ providerId: "microsoft", idToken: null }),
    ).toBeUndefined();
    expect(
      stampMicrosoftTenantId({ providerId: "microsoft", idToken: "garbage" }),
    ).toBeUndefined();
    expect(
      stampMicrosoftTenantId({
        providerId: "microsoft",
        idToken: fakeIdToken({}),
      }),
    ).toBeUndefined();
  });
});

describe("accountTypeMismatchMessage", () => {
  test("directs to the correct app", () => {
    expect(accountTypeMismatchMessage("business")).toContain("openbookings.co");
    expect(accountTypeMismatchMessage("private")).toContain(
      "business.openbookings.co",
    );
  });
});
