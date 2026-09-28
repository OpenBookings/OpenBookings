import { describe, expect, test } from "bun:test";
import { CACHE_SCHEMA_VERSION, propertyPageKey } from "./keys";

describe("propertyPageKey", () => {
  test("uses the ob:<version>:prop-page:<slug> shape", () => {
    expect(propertyPageKey("terme-di-saturnia")).toBe("ob:v1:prop-page:terme-di-saturnia");
  });

  /**
   * The read side lowercases the URL segment (`page.tsx` does `.toLowerCase()`)
   * while the purge side passes the `slug` column verbatim. If those two ever
   * disagree in case, every purge misses its key and hosts see a stale page
   * until the TTL expires — a silent, hours-long bug. Normalising in one place
   * is what makes the two callers agree by construction.
   */
  test("normalises case, so the reader and the purger agree", () => {
    expect(propertyPageKey("Terme-Di-Saturnia")).toBe(propertyPageKey("terme-di-saturnia"));
  });

  test("carries the schema version, so a shape change orphans old entries", () => {
    expect(propertyPageKey("x")).toContain(`:${CACHE_SCHEMA_VERSION}:`);
  });
});
