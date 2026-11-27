import { describe, expect, test } from "bun:test";
import { bootstrapMatches, relyingParty } from "./enrol";

describe("bootstrapMatches", () => {
  test("matches the exact code, ignoring surrounding spaces", () => {
    expect(bootstrapMatches("open sesame", "open sesame")).toBe(true);
    expect(bootstrapMatches(" open sesame ", "open sesame")).toBe(true);
    expect(bootstrapMatches("open sesamE", "open sesame")).toBe(false);
    expect(bootstrapMatches("open", "open sesame")).toBe(false);
    expect(bootstrapMatches(undefined, "open sesame")).toBe(false);
  });

  test("an unset or blank code never matches", () => {
    for (const expected of [undefined, "", "   "]) {
      expect(bootstrapMatches("", expected)).toBe(false);
      expect(bootstrapMatches("   ", expected)).toBe(false);
      expect(bootstrapMatches(undefined, expected)).toBe(false);
    }
  });
});

describe("relyingParty", () => {
  test("production: ADMIN_RP_ID over https, else the host name", () => {
    expect(relyingParty({ NODE_ENV: "production", ADMIN_RP_ID: "admin.example.com" }, "evil.example:443")).toEqual({
      rpID: "admin.example.com",
      origin: "https://admin.example.com",
    });
    expect(relyingParty({ NODE_ENV: "production" }, "admin.example.com")).toEqual({
      rpID: "admin.example.com",
      origin: "https://admin.example.com",
    });
  });

  test("development uses the dev server's own origin", () => {
    expect(relyingParty({ NODE_ENV: "development" }, "localhost:3005")).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3005",
    });
  });

  test("refuses without a host or ADMIN_RP_ID", () => {
    expect(() => relyingParty({ NODE_ENV: "production" }, null)).toThrow(/ADMIN_RP_ID/);
  });
});
