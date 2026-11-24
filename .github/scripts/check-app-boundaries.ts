/**
 * An app in apps/ that must stay independent of core may depend on a fixed
 * list of workspace packages and no others. Today that is apps/siteminder:
 * it talks to core over the Apps API and shares only the contract.
 *
 * Fails (exit 1) when the app's package.json lists a forbidden package, or any
 * of its src/**\/*.ts files imports one.
 *
 * Usage: bun .github/scripts/check-app-boundaries.ts [repo-root]
 */
import { Glob } from "bun";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const FORBIDDEN_PACKAGES = [
  "@openbookings/db",
  "@openbookings/authz",
  "@openbookings/pricing",
  "@openbookings/stripe",
  "@openbookings/mailing",
  "@openbookings/support",
  "@openbookings/messaging",
] as const;

const GUARDED_APPS = ["siteminder"] as const;

function isForbidden(specifier: string): boolean {
  return FORBIDDEN_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

/** Module specifiers named by import/export-from/require/dynamic import. */
function specifiersIn(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

export async function findViolations(root: string, apps: readonly string[] = GUARDED_APPS): Promise<string[]> {
  const violations: string[] = [];
  for (const app of apps) {
    const appDir = path.join(root, "apps", app);
    const pkgPath = path.join(appDir, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        if (isForbidden(name)) violations.push(`${path.relative(root, pkgPath)}: ${section} lists ${name}`);
      }
    }
    for await (const file of new Glob("src/**/*.ts").scan({ cwd: appDir })) {
      const full = path.join(appDir, file);
      for (const specifier of specifiersIn(await readFile(full, "utf8"))) {
        if (isForbidden(specifier)) violations.push(`${path.relative(root, full)}: imports ${specifier}`);
      }
    }
  }
  return violations;
}

if (import.meta.main) {
  const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../.."));
  const violations = await findViolations(root);
  if (violations.length > 0) {
    console.error("App boundary violations:\n  " + violations.join("\n  "));
    process.exit(1);
  }
  console.log(`App boundaries ok (${GUARDED_APPS.join(", ")}).`);
}
