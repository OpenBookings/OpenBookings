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
});
