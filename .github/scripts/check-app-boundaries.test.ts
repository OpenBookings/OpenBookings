import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findViolations } from "./check-app-boundaries";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "boundaries-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(root, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

const cleanPackage = JSON.stringify({ dependencies: { "@openbookings/apps-contract": "workspace:*", hono: "^4" } });

describe("check-app-boundaries", () => {
  it("passes on an app that only uses the apps contract", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": cleanPackage,
      "apps/siteminder/src/index.ts": `import { z } from "zod";\nimport { x } from "@openbookings/apps-contract";\n`,
    });
    expect(await findViolations(root)).toEqual([]);
  });

  it("fails on a source file importing @openbookings/db", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": cleanPackage,
      "apps/siteminder/src/deep/a.ts": `import { db } from "@openbookings/db";\n`,
    });
    const violations = await findViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("a.ts");
    expect(violations[0]).toContain("@openbookings/db");
  });

  it("catches subpath, dynamic and re-export imports", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": cleanPackage,
      "apps/siteminder/src/a.ts": `import { f } from "@openbookings/pricing/money";\n`,
      "apps/siteminder/src/b.ts": `const m = await import("@openbookings/stripe");\n`,
      "apps/siteminder/src/c.ts": `export * from "@openbookings/mailing";\n`,
      "apps/siteminder/src/d.ts": `import "@openbookings/messaging";\n`,
    });
    expect(await findViolations(root)).toHaveLength(4);
  });

  it("does not mistake a lookalike package for a forbidden one", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": cleanPackage,
      "apps/siteminder/src/a.ts": `import x from "@openbookings/database-tools";\n`,
    });
    expect(await findViolations(root)).toEqual([]);
  });

  it("fails on a forbidden package listed in package.json", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": JSON.stringify({ devDependencies: { "@openbookings/authz": "workspace:*" } }),
      "apps/siteminder/src/index.ts": `export {};\n`,
    });
    const violations = await findViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("@openbookings/authz");
  });

  it("catches compact, star-export, template-literal, multi-line, type-only and require forms", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": cleanPackage,
      "apps/siteminder/src/a.ts": `import{db}from"@openbookings/db"`,
      "apps/siteminder/src/b.ts": `export*from"@openbookings/db"`,
      "apps/siteminder/src/c.ts": "const m = await import(`@openbookings/messaging`)",
      "apps/siteminder/src/d.ts": `import {\n  a,\n  b,\n} from "@openbookings/pricing/money";`,
      "apps/siteminder/src/e.ts": `const s = require("@openbookings/stripe");`,
      "apps/siteminder/src/f.ts": `import type { X } from "@openbookings/authz";`,
    });
    expect(await findViolations(root)).toHaveLength(6);
  });

  it("scans other extensions and files outside src, but not node_modules", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": cleanPackage,
      "apps/siteminder/src/a.tsx": `import { db } from "@openbookings/db";`,
      "apps/siteminder/src/b.mts": `import { db } from "@openbookings/db";`,
      "apps/siteminder/src/c.cts": `const x = require("@openbookings/db");`,
      "apps/siteminder/src/d.js": `import { db } from "@openbookings/db";`,
      "apps/siteminder/scripts/e.mjs": `import { db } from "@openbookings/db";`,
      "apps/siteminder/f.cjs": `require("@openbookings/db");`,
      "apps/siteminder/node_modules/x/index.js": `require("@openbookings/db");`,
    });
    expect(await findViolations(root)).toHaveLength(6);
  });

  it("fails on a forbidden peerDependency", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": JSON.stringify({ peerDependencies: { "@openbookings/db": "*" } }),
    });
    expect(await findViolations(root)).toHaveLength(1);
  });

  it("fails when a file elsewhere imports a path inside the app (pruned images would not contain it)", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": JSON.stringify({ name: "@openbookings/siteminder" }),
      "apps/siteminder/scripts/local-db.ts": `export const x = 1;\n`,
      "apps/business/scripts/e2e.ts": `import { x } from "../../siteminder/scripts/local-db";\n`,
      "apps/web/lib/a.ts": `const m = await import("../../siteminder/src/env");\n`,
      "packages/db/src/b.ts": `import { y } from "@openbookings/siteminder/src/ota/res-notif";\n`,
      "testing/scripts/c.ts": `export * from "@openbookings/siteminder";\n`,
    });
    const violations = await findViolations(root);
    expect(violations).toHaveLength(4);
    expect(violations[0]).toContain("apps/business/scripts/e2e.ts: imports ../../siteminder/scripts/local-db, inside apps/siteminder");
  });

  it("fails when another workspace lists the app as a dependency", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": JSON.stringify({ name: "@openbookings/siteminder" }),
      "apps/business/package.json": JSON.stringify({ devDependencies: { "@openbookings/siteminder": "workspace:*" } }),
    });
    expect(await findViolations(root)).toEqual(["apps/business/package.json: devDependencies lists @openbookings/siteminder"]);
  });

  it("allows lookalikes, the word in strings, the app's own relative imports, and build output", async () => {
    const root = await fixture({
      "apps/siteminder/package.json": JSON.stringify({ name: "@openbookings/siteminder" }),
      "apps/siteminder/scripts/a.ts": `import { b } from "../src/b";\n`,
      "apps/business/scripts/a.ts": `import { x } from "../../siteminder-tools/x";\nconst label = "SiteMinder siteminder";\n`,
      "apps/business/lib/b.ts": `import { s } from "@openbookings/siteminder-contract";\n`,
      "apps/business/.next/server/c.js": `require("../../../siteminder/src/index");\n`,
      "apps/docs/node_modules/x/d.js": `require("@openbookings/siteminder");\n`,
    });
    expect(await findViolations(root)).toEqual([]);
  });
});
