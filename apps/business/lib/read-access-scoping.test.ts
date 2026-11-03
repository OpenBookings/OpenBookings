import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { AVAILABILITY_SQL, VERSION_SQL } from "@/app/(dashboard)/dashboard/listings/rates-availability/_lib/ari-query";

/**
 * Dashboard reads scope to the properties the signed-in member can read
 * (propertyReadAccessSql: org membership, property_access for the scoped
 * roles), never to `properties.owner_user_id`. That column names only the
 * founding owner: scoping by it hides a property from every co-owner, admin
 * and manager, and (before the column was kept in sync) kept showing it to a
 * founder who had left.
 */

const ROOT = join(import.meta.dir, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Writes at onboarding time legitimately stamp or look up the column.
const ALLOWED = [join("app", "(onboarding)", "onboarding", "actions.ts"), join("app", "(onboarding)", "onboarding", "promotion.ts")];

describe("dashboard reads are scoped by access, not by owner_user_id", () => {
  test("no query outside onboarding filters on owner_user_id = $n", () => {
    const offenders = sourceFiles(ROOT)
      .map((file) => relative(ROOT, file))
      .filter((file) => !ALLOWED.includes(file))
      .filter((file) => /owner_user_id\s*=\s*\$\d+/.test(readFileSync(join(ROOT, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  test("the ARI queries use the shared read-access predicate", () => {
    for (const sql of [AVAILABILITY_SQL, VERSION_SQL]) {
      expect(sql).toContain('"member" m');
      expect(sql).toContain("property_access pa");
      expect(sql).not.toMatch(/owner_user_id\s*=\s*\$1\s+AND/);
    }
  });
});
