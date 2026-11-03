import { describe, expect, test } from "bun:test";
import { hostTrustedOrigins } from "./trusted-origins";

describe("hostTrustedOrigins", () => {
  test("production trusts only the host portal itself", () => {
    expect(hostTrustedOrigins("production")).toEqual(["https://business.openbookings.co"]);
  });

  test("never trusts the guest origin, Apple, or any localhost in production", () => {
    const origins = hostTrustedOrigins("production").join(" ");
    expect(origins).not.toContain("//openbookings.co");
    expect(origins).not.toContain("apple");
    expect(origins).not.toContain("localhost");
  });

  test("development and test add the local portal origin", () => {
    for (const env of ["development", "test", undefined]) {
      expect(hostTrustedOrigins(env)).toContain("http://business.localhost:3001");
    }
  });

  test("the guest origin is never trusted, in any environment", () => {
    for (const env of ["production", "development", "test", undefined]) {
      expect(hostTrustedOrigins(env)).not.toContain("https://openbookings.co");
    }
  });
});
