import { describe, expect, test } from "bun:test";
import { bearerAuthorized } from "./cron-auth";

const req = (authorization?: string) =>
  new Request("http://localhost/api/cron/x", { method: "POST", headers: authorization ? { authorization } : {} });

describe("bearerAuthorized", () => {
  test("accepts exactly the configured secret", () => {
    expect(bearerAuthorized(req("Bearer s3cret"), "s3cret")).toBe(true);
  });
  // (A trailing space is not tested: Headers strips it before the helper sees it.)
  test("rejects wrong, prefix, extended, differently-cased and missing credentials", () => {
    for (const header of ["Bearer wrong!", "Bearer s3cre", "Bearer s3cret!", "bearer s3cret", "Bearer S3CRET", "s3cret", ""]) {
      expect(bearerAuthorized(req(header || undefined), "s3cret")).toBe(false);
    }
  });
  test("no secret configured means nothing is authorized, even an empty bearer", () => {
    expect(bearerAuthorized(req("Bearer "), undefined)).toBe(false);
    expect(bearerAuthorized(req("Bearer "), "")).toBe(false);
    expect(bearerAuthorized(req(), undefined)).toBe(false);
  });
});
