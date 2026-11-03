import { describe, expect, test } from "bun:test";
import { bearerAuthorized, parseRevalidatePaths } from "./revalidate-request";

describe("bearerAuthorized", () => {
  test("accepts the exact bearer secret", () => {
    expect(bearerAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  });

  test("rejects a wrong, missing or unconfigured secret", () => {
    expect(bearerAuthorized("Bearer nope00", "s3cret")).toBe(false);
    expect(bearerAuthorized(null, "s3cret")).toBe(false);
    expect(bearerAuthorized("Bearer ", undefined)).toBe(false);
  });
});

describe("parseRevalidatePaths", () => {
  test("accepts listing paths and drops duplicates", () => {
    expect(parseRevalidatePaths({ paths: ["/p/terme-di-saturnia", "/p/terme-di-saturnia"] })).toEqual([
      "/p/terme-di-saturnia",
    ]);
  });

  test("rejects anything that is not a listing path", () => {
    expect(parseRevalidatePaths({ paths: ["/"] })).toBeNull();
    expect(parseRevalidatePaths({ paths: ["/p/a/rooms/b"] })).toBeNull();
    expect(parseRevalidatePaths({ paths: ["/p/../account"] })).toBeNull();
    expect(parseRevalidatePaths({ paths: ["/p/Upper"] })).toBeNull();
  });

  test("rejects empty, oversized or malformed bodies", () => {
    expect(parseRevalidatePaths({ paths: [] })).toBeNull();
    expect(parseRevalidatePaths({ paths: Array.from({ length: 21 }, (_, i) => `/p/h${i}`) })).toBeNull();
    expect(parseRevalidatePaths({ paths: "/p/a" })).toBeNull();
    expect(parseRevalidatePaths(null)).toBeNull();
  });
});
