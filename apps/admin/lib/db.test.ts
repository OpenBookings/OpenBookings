import { describe, expect, test } from "bun:test";
import { AdminReadOnlyError, adminDbConfig, adminDbLabel, withWriteTransaction, writeLifecycleDb, writePool } from "./db";
import { databaseHost } from "./super-admin";

const READ = "postgres://admin_reader:x@read.example.test/neondb?sslmode=require";
const WRITE = "postgres://admin_writer:x@write.example.test/neondb?sslmode=require";

describe("adminDbConfig", () => {
  test("neither set: DATABASE_URL for everything (local development)", () => {
    expect(adminDbConfig({ DATABASE_URL: "postgres://local" })).toEqual({ kind: "shared" });
    expect(adminDbConfig({ ADMIN_DATABASE_URL_READ: " ", ADMIN_DATABASE_URL_WRITE: "" })).toEqual({ kind: "shared" });
  });

  test("both set: the two roles", () => {
    expect(adminDbConfig({ ADMIN_DATABASE_URL_READ: READ, ADMIN_DATABASE_URL_WRITE: WRITE, DATABASE_URL: "postgres://x" })).toEqual({
      kind: "roles",
      read: READ,
      write: WRITE,
    });
  });

  test("only READ set: read-only, actions refuse", () => {
    const env = { ADMIN_DATABASE_URL_READ: READ, DATABASE_URL: "postgres://full-access" };
    expect(adminDbConfig(env)).toEqual({ kind: "roles", read: READ, write: null });

    const saved = { read: process.env.ADMIN_DATABASE_URL_READ, write: process.env.ADMIN_DATABASE_URL_WRITE };
    process.env.ADMIN_DATABASE_URL_READ = READ;
    delete process.env.ADMIN_DATABASE_URL_WRITE;
    try {
      expect(() => writePool()).toThrow(AdminReadOnlyError);
      expect(() => writeLifecycleDb()).toThrow(AdminReadOnlyError);
      expect(() => withWriteTransaction(async () => 1)).toThrow(AdminReadOnlyError);
    } finally {
      for (const [key, value] of [["ADMIN_DATABASE_URL_READ", saved.read], ["ADMIN_DATABASE_URL_WRITE", saved.write]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("only WRITE set is refused rather than reading through DATABASE_URL", () => {
    expect(() => adminDbConfig({ ADMIN_DATABASE_URL_WRITE: WRITE })).toThrow(/without ADMIN_DATABASE_URL_READ/);
  });
});

describe("adminDbLabel", () => {
  test("names the database each connection points at", () => {
    expect(adminDbLabel(databaseHost, { DATABASE_URL: "postgres://u@db.local/x" })).toBe("db.local");
    expect(adminDbLabel(databaseHost, { ADMIN_DATABASE_URL_READ: READ })).toBe("read.example.test (read-only)");
    expect(adminDbLabel(databaseHost, { ADMIN_DATABASE_URL_READ: READ, ADMIN_DATABASE_URL_WRITE: WRITE })).toBe(
      "read.example.test (read) / write.example.test (write)",
    );
    expect(adminDbLabel(databaseHost, { ADMIN_DATABASE_URL_READ: READ, ADMIN_DATABASE_URL_WRITE: READ })).toBe(
      "read.example.test (admin roles)",
    );
  });
});
