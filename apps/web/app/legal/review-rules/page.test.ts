import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The review rules page states what the moderation code does. Read as source:
 * the statements sit in JSX, with &apos; for apostrophes.
 */
const source = readFileSync(join(import.meta.dir, "page.tsx"), "utf8").replace(/\s+/g, " ").replaceAll("&apos;", "'");

describe("review rules page", () => {
  test("§3: a held text whose flagged words couldn't be pinpointed waits for a person (publishOverdue)", () => {
    expect(source).toContain("If we can't tell which words broke a rule, it waits for a person instead of being published automatically.");
  });

  test("§4: a rewritten review starts a new thread (submitReview's closeOldThread)", () => {
    expect(source).toContain(
      "The property's replies to the removed review, and the guest's answers to them, are deleted when the guest writes it again: the property can reply to the new review.",
    );
  });
});
