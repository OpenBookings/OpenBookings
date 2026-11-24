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

const LOADERS: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".js": "js", ".mjs": "js", ".cjs": "js",
};

/**
 * Module specifiers a file names. The transpiler's parser covers import,
 * export-from, require() and dynamic import; it drops type-only imports, so a
 * loose regex over the source (which also catches template-literal specifiers)
 * backs it up. Over-reporting is fine here: a forbidden name in that position is
 * a violation either way.
 */
function specifiersIn(source: string, ext: string): string[] {
  const found = new Set<string>();
  try {
    for (const imp of new Bun.Transpiler({ loader: LOADERS[ext] }).scanImports(source)) found.add(imp.path);
  } catch {
    // Unparseable: the regex below still looks.
  }
  for (const match of source.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"`]([^'"`]+)['"`]/g)) found.add(match[1]!);
  return [...found];
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
    for await (const file of new Glob("**/*.{ts,tsx,mts,cts,js,mjs,cjs}").scan({ cwd: appDir })) {
      if (file.split("/").includes("node_modules")) continue;
      const full = path.join(appDir, file);
      for (const specifier of specifiersIn(await readFile(full, "utf8"), path.extname(file))) {
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
