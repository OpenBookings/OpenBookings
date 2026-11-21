import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every console write is pinned to the current hotel: each call to an authz
 * write check passes the pin (currentPropertyPin, or a `pin` resolved from
 * it), so a stale tab still showing hotel A cannot write to A after the user
 * switched to B. A new call site without one fails here.
 */

const ROOT = join(import.meta.dir, "..");
const CHECKS = /\b(userCan|userOwnsProperty|userOwnsRoom|userOwnsRatePlan)\(/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The argument text of the call whose "(" is at `open`. */
function argsAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

describe("console writes are pinned to the current hotel", () => {
  test("every authz write check passes the current-hotel pin", () => {
    const unpinned: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(CHECKS)) {
        const args = argsAt(source, match.index! + match[0].length - 1);
        if (!/\bpin\b|currentPropertyPin\(\)/.test(args)) {
          const line = source.slice(0, match.index).split("\n").length;
          unpinned.push(`${relative(ROOT, file)}:${line} ${match[1]}`);
        }
      }
    }
    expect(unpinned).toEqual([]);
  });
});
