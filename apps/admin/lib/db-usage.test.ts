/**
 * Which connection each part of the console may use (see ./db.ts):
 * pages and loaders the read one, server actions the write one, and nothing
 * the shared DATABASE_URL pool behind them.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
    .map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)));
}

const FILES = ["app", "lib", "components"].flatMap(sources);
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const isServerAction = (src: string) => /^\s*["']use server["']/.test(src);

const WRITE_HELPERS = /\b(writePool|withWriteTransaction|writeLifecycleDb)\b/;
/** Lifecycle calls that fall back to the shared pool without a `db`. */
const LIFECYCLE_CALL = /\b(cancelRooms|markCheckedIn|markNoShow|recordEarlyDeparture|issueGoodwillRefund|retryRefunds|previewRefund)\(/;
/** Mail sends that fall back to the shared pool without `deps.db`. */
const MAIL_CALL = /\bsend(Cancellation|RefundIssued|Booking\w*)\(/;

describe("admin database connections", () => {
  test("the sources were found", () => {
    expect(FILES).toContain("lib/db.ts");
    expect(FILES).toContain("app/flagged-payments/page.tsx");
  });

  test("nothing but lib/db.ts takes the shared pool from @openbookings/db", () => {
    const offenders = FILES.filter((file) => file !== "lib/db.ts").filter((file) =>
      [...read(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@openbookings\/db["']/g)].some((m) =>
        /\b(getPool|withTransaction|query|queryOne)\b/.test(m[1]!),
      ),
    );
    expect(offenders).toEqual([]);
  });

  test("pages, layouts and components never reach the write connection", () => {
    const offenders = FILES.filter((file) => !file.startsWith("lib/")).filter((file) => WRITE_HELPERS.test(read(file)));
    expect(offenders).toEqual([]);
  });

  test("only server actions use the write connection", () => {
    const offenders = FILES.filter((file) => file !== "lib/db.ts")
      .filter((file) => WRITE_HELPERS.test(read(file)))
      .filter((file) => !isServerAction(read(file)));
    expect(offenders).toEqual([]);
  });

  test("every page that reads the database reads through readPool", () => {
    const pages = FILES.filter((file) => /(^|\/)(page|layout)\.tsx$/.test(file));
    expect(pages.length).toBeGreaterThan(0);
    const offenders = pages
      .filter((file) => /\.query\(|load\w+\(|search\w+\(/.test(read(file)))
      .filter((file) => !/\breadPool\(\)/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  test("lifecycle calls and booking emails are given the admin connection", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      read(file)
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(import|\*|\/\/)/.test(line)) return;
          if (LIFECYCLE_CALL.test(line) && !/\bdeps\(\)|\bdb:/.test(line)) offenders.push(`${file}:${i + 1}`);
          if (MAIL_CALL.test(line) && !/\bmailDeps\(\)/.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
