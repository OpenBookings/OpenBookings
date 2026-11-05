import { describe, expect, test } from "bun:test";
import { databaseHost, isSuperAdminEnabled } from "./super-admin";

describe("isSuperAdminEnabled", () => {
  test('on only with "1" in development', () => {
    expect(isSuperAdminEnabled({ ADMIN_SUPER_MODE: "1", NODE_ENV: "development" })).toBe(true);
  });

  test("off for look-alike values", () => {
    for (const v of ["true", " 1", "0", "", undefined]) {
      expect(isSuperAdminEnabled({ ADMIN_SUPER_MODE: v, NODE_ENV: "development" })).toBe(false);
    }
  });

  test("off in production and test", () => {
    for (const env of ["production", "test"]) {
      expect(isSuperAdminEnabled({ ADMIN_SUPER_MODE: "1", NODE_ENV: env })).toBe(false);
    }
  });
});

describe("databaseHost", () => {
  test("extracts the host", () => {
    expect(databaseHost("postgres://u:p@ep-x.neon.tech/db?sslmode=require")).toBe("ep-x.neon.tech");
  });
  test("unknown for missing or invalid", () => {
    expect(databaseHost(undefined)).toBe("unknown");
    expect(databaseHost("not a url")).toBe("unknown");
  });
});
