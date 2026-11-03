import { describe, expect, test } from "bun:test";
import { z } from "zod";

// The schema itself lives in a "use server" file, which may export only async
// functions, so this pins the rule by reading the source: a refactor that
// loosens it back to any 3-letter string must fail here.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");

describe("createRatePlan currency", () => {
  test("is restricted to EUR", () => {
    expect(source).toMatch(/currency:\s*z\.literal\("EUR"\)/);
    expect(source).not.toMatch(/currency:\s*z\.string\(\)/);
    expect(z.literal("EUR").safeParse("USD").success).toBe(false);
  });
});
