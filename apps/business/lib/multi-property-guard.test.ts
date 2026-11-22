import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Source guards for "one hotel at a time" (multi-property switching). The
 * console has one current hotel per session (lib/current-property.ts) and its
 * org (lib/active-org.ts); these fail when new code goes around them. The
 * behaviour itself is proven against Postgres in
 * multi-property-isolation.db.test.ts.
 */

const ROOT = join(import.meta.dir, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

/** Every non-test source file in apps/business, as [relative path with "/", contents]. */
const SOURCES: [string, string][] = sourceFiles(ROOT).map((file) => [
  relative(ROOT, file).split(sep).join("/"),
  readFileSync(file, "utf8"),
]);

const offending = (pattern: RegExp, allowed: readonly string[] = []) =>
  SOURCES.filter(([file, text]) => !allowed.includes(file) && pattern.test(text)).map(([file]) => file);

describe("the console reads one hotel, the current one", () => {
  test("the scan sees the app", () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(SOURCES.map(([file]) => file)).toContain("lib/current-property.ts");
  });

  test('no query picks a hotel by name ("ORDER BY p.name LIMIT 1"): the current hotel comes from the session', () => {
    // A user with several hotels would silently get the alphabetically first
    // one. Whitespace and case do not matter.
    expect(offending(/ORDER\s+BY\s+p\.name\s+LIMIT\s+1\b/i)).toEqual([]);
  });

  test("getHostScopedDb (every hotel the user can read) is used only where a page really spans hotels", () => {
    // File → why it may read across the user's hotels. Empty today: every
    // console read is bound to the current hotel (getPropertyScopedDb) or to
    // its org (getOrgScopedDb). A new entry needs a reason here and a one-line
    // comment at the call.
    const ALLOWED: Record<string, string> = {};
    expect(offending(/\bgetHostScopedDb\b/, Object.keys(ALLOWED))).toEqual([]);
    for (const file of Object.keys(ALLOWED)) {
      expect(SOURCES.find(([f]) => f === file)?.[1]).toMatch(/\bgetHostScopedDb\b/);
    }
  });
});

describe("the console's org is the current hotel's", () => {
  test("only active-org and current-property read the session's activeOrganizationId", () => {
    // The org plugin's activeOrganizationId on the session can be up to a
    // minute stale after a switch (cookie cache) and is not the current
    // hotel's org. Reads go through activeOrgId; writing it as an object key
    // ({ activeOrganizationId: orgId }) or naming the column in SQL is fine.
    const reads = [
      /\bsession\??\.activeOrganizationId\b/, // session.x, session?.x, s.session.x, s?.session?.x
      /\bsession\??\.\[\s*["'`]activeOrganizationId["'`]\s*\]/, // session["x"]
      /\{[^{}]*\bactiveOrganizationId\b[^{}]*\}\s*=\s*[\w.?]*session\b/, // const { x } = ….session
    ];
    const allowed = ["lib/active-org.ts", "lib/current-property.ts"];
    for (const pattern of reads) expect(offending(pattern, allowed)).toEqual([]);
  });

  test("the session-read guard catches what it should and lets keys and SQL through", () => {
    const read = /\bsession\??\.activeOrganizationId\b/;
    expect(read.test("const org = session.session.activeOrganizationId;")).toBe(true);
    expect(read.test("s?.session?.activeOrganizationId")).toBe(true);
    expect(read.test("session.activeOrganizationId")).toBe(true);
    expect(read.test("getOrgScopedDb({ user, session: { activeOrganizationId: orgId } })")).toBe(false);
    expect(read.test(`UPDATE "session" SET "activeOrganizationId" = $1`)).toBe(false);
  });

  test("team actions always name the org: Better Auth would otherwise use the cookie's active org", () => {
    // createInvitation, updateMemberRole and removeMember default to the
    // session's activeOrganizationId, which can lag a hotel switch.
    const calls: { file: string; endpoint: string; args: string }[] = [];
    for (const [file, text] of SOURCES) {
      for (const match of text.matchAll(/\bauth\.api\s*\.\s*(createInvitation|updateMemberRole|removeMember)\s*\(/g)) {
        calls.push({ file, endpoint: match[1]!, args: balancedArgs(text, match.index! + match[0].length) });
      }
    }
    expect(calls.map((c) => c.endpoint).sort()).toEqual(["createInvitation", "removeMember", "updateMemberRole"]);
    for (const call of calls) {
      expect({ ...call, ok: /\borganizationId\s*:/.test(call.args) }).toMatchObject({ ok: true });
    }
  });
});

/** The text of a call's arguments, from just after "(" to its matching ")". */
function balancedArgs(text: string, start: number): string {
  let depth = 1;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")" && --depth === 0) return text.slice(start, i);
  }
  return text.slice(start);
}
