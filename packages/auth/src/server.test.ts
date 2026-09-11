import { describe, expect, test } from "bun:test";
import { getIp } from "better-auth/api";
import {
  accountTypeMismatchMessage,
  buildAccountTypeHooks,
  IP_ADDRESS_HEADERS,
  isAccountTypeAllowed,
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
    await expect(hooks.session.create.before(makeSession())).resolves.toBeUndefined();
  });

  test("matching account signs in on business", async () => {
    const hooks = buildAccountTypeHooks("business", async () => "business");
    await expect(hooks.session.create.before(makeSession())).resolves.toBeUndefined();
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

describe("accountTypeMismatchMessage", () => {
  test("directs to the correct app", () => {
    expect(accountTypeMismatchMessage("business")).toContain("openbookings.co");
    expect(accountTypeMismatchMessage("private")).toContain(
      "business.openbookings.co",
    );
  });
});

// Client IP resolution. These run Better Auth's own resolver against the
// header list createAuth ships, so a change in either — our ordering or an
// upstream tightening of what counts as trustworthy — fails here rather than
// silently collapsing rate limiting into one shared per-path bucket.

const ipOptions = {
  advanced: { ipAddress: { ipAddressHeaders: IP_ADDRESS_HEADERS } },
} as never;

const resolveIp = (headers: Record<string, string>) =>
  getIp(new Headers(headers), ipOptions);

describe("IP_ADDRESS_HEADERS", () => {
  test("cf-connecting-ip resolves behind a multi-hop forwarded chain", () => {
    expect(
      resolveIp({
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "203.0.113.7, 172.71.0.1, 10.0.0.5",
      }),
    ).toBe("203.0.113.7");
  });

  test("cf-connecting-ip is preferred over x-forwarded-for", () => {
    expect(
      resolveIp({
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "198.51.100.9",
      }),
    ).toBe("203.0.113.7");
  });

  test("falls back to a single-hop x-forwarded-for", () => {
    expect(resolveIp({ "x-forwarded-for": "198.51.100.9" })).toBe(
      "198.51.100.9",
    );
  });

  test("a garbage cf-connecting-ip falls through instead of being trusted", () => {
    expect(
      resolveIp({
        "cf-connecting-ip": "not-an-ip",
        "x-forwarded-for": "198.51.100.9",
      }),
    ).toBe("198.51.100.9");
  });

  test("distinct clients get distinct rate-limit buckets", () => {
    const a = resolveIp({ "cf-connecting-ip": "203.0.113.7" });
    const b = resolveIp({ "cf-connecting-ip": "203.0.113.8" });
    expect(a).not.toBe(b);
  });
});
