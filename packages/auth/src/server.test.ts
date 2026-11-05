import { describe, expect, test } from "bun:test";
import { getIP } from "better-auth/api";
import {
  accountTypeMismatchMessage,
  advancedConfig,
  buildAccountTypeHooks,
  IP_ADDRESS_HEADERS,
  isAccountTypeAllowed,
  isStepUpFresh,
  portalForAccountType,
  sessionVerificationStamp,
  sessionCookieNames,
  sessionForApp,
  stepUpRequiredForRequest,
  stepUpSatisfied,
  isFactorStepUpFresh,
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
    expect(advancedConfig("ob-host", false).crossSubDomainCookies.enabled).toBe(false);
    expect(advancedConfig("ob-host", true).crossSubDomainCookies.enabled).toBe(false);
  });

  test("production config names core cookies __Host- and disables the __Secure- auto-prefix", () => {
    const config = advancedConfig("ob-host", true);
    expect(config.useSecureCookies).toBe(false);
    expect(config.cookies?.session_token.name).toBe("__Host-ob-host.session_token");
    expect(config.cookies?.session_token.attributes.secure).toBe(true);
    expect(config.defaultCookieAttributes?.secure).toBe(true);
  });

  test("dev config sets no domain and no __Host- names", () => {
    const config = advancedConfig("ob-guest", false);
    expect(config).toEqual({
      cookiePrefix: "ob-guest",
      crossSubDomainCookies: { enabled: false },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
    });
  });

  test("both instances resolve the client IP from the same headers", () => {
    // Regression guard: the guest/host split must not drop the ipAddress
    // config main added. Without it Better Auth cannot resolve an IP behind
    // Cloudflare and every request collapses into one rate-limit bucket.
    for (const secure of [false, true]) {
      for (const prefix of ["ob-guest", "ob-host"]) {
        expect(advancedConfig(prefix, secure).ipAddress.ipAddressHeaders).toEqual([
          "cf-connecting-ip",
          "x-forwarded-for",
        ]);
      }
    }
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

describe("stepUpRequiredForRequest — admin plugin endpoints", () => {
  test("every /admin/* endpoint needs a fresh step-up", () => {
    for (const path of [
      "/admin/impersonate-user",
      "/admin/set-role",
      "/admin/ban-user",
      "/admin/set-user-password",
      "/admin/remove-user",
      "/admin/create-user",
      "/admin/revoke-user-sessions",
      "/admin/list-users",
    ]) {
      expect(stepUpRequiredForRequest(path, {})).toBe(true);
    }
  });

  test("leaving an impersonation is not gated (that session has no step-up of its own)", () => {
    expect(stepUpRequiredForRequest("/admin/stop-impersonating", {})).toBe(false);
  });

  test("does not catch lookalike paths", () => {
    expect(stepUpRequiredForRequest("/administrator", {})).toBe(false);
    expect(stepUpRequiredForRequest("/get-session", {})).toBe(false);
  });
});

describe("stepUpRequiredForRequest — endpoints Better Auth gated on freshness", () => {
  // freshAge is 0 on both instances, so the step-up gate takes over.
  test("unlinking a social account needs a fresh step-up", () => {
    expect(stepUpRequiredForRequest("/unlink-account", {})).toBe(true);
  });

  test("listing sessions does not", () => {
    expect(stepUpRequiredForRequest("/list-sessions", {})).toBe(false);
  });
});

describe("sessionVerificationStamp", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  test("a normal sign-in starts the step-up clock", () => {
    expect(sessionVerificationStamp({ userId: "u1" }, now)).toEqual({ userId: "u1", lastVerifiedAt: now });
  });

  test("an impersonation session does not inherit a fresh step-up", () => {
    const stamped = sessionVerificationStamp({ userId: "host", impersonatedBy: "staff" }, now);
    expect(stamped.lastVerifiedAt).toBeUndefined();
    expect(stamped.impersonatedBy).toBe("staff");
  });
});
