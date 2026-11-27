import { describe, expect, test } from "bun:test";
import { resolveStaff } from "./staff";

const found = { userId: "u1", email: "staff@example.com" };
const dbFound = { query: async () => ({ rows: [{ id: "u1", email: "staff@example.com" }] }) };
const dbNone = { query: async () => ({ rows: [] }) };
const dbNever = {
  query: async () => {
    throw new Error("must not query");
  },
};

describe("resolveStaff", () => {
  test("development super mode is staff without a lookup", async () => {
    const env = { NODE_ENV: "development", ADMIN_SUPER_MODE: "1" };
    expect(await resolveStaff("dev@localhost", env, dbNever)).toEqual({ userId: "dev", email: "dev@localhost" });
  });

  test("production with ADMIN_SUPER_MODE=1 still looks the email up", async () => {
    const env = { NODE_ENV: "production", ADMIN_SUPER_MODE: "1" };
    expect(await resolveStaff("staff@example.com", env, dbFound)).toEqual(found);
    expect(await resolveStaff("nobody@example.com", env, dbNone)).toBeNull();
  });

  test("a missing email is never staff", async () => {
    expect(await resolveStaff(null, { NODE_ENV: "production" }, dbNever)).toBeNull();
    expect(await resolveStaff("", { NODE_ENV: "production" }, dbNever)).toBeNull();
  });
});
