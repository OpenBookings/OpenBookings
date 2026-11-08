import { describe, expect, test } from "bun:test";
import { amsterdamDate, ArgsError, backfillMonths, parseArgs } from "./args";

// 8 November 2026, 10:00 in Amsterdam.
const NOW = new Date("2026-11-08T09:00:00Z");

const months = (from: string, now = NOW) => {
  const args = parseArgs(["--step=backfill", `--from=${from}`], now);
  return backfillMonths(args.from!, now).map((p) => p.start.slice(0, 7));
};

describe("parseArgs", () => {
  test("defaults to the previous Amsterdam month", () => {
    expect(parseArgs(["--step=draft"], NOW).period.start).toBe("2026-10-01");
    // 1 November 00:30 in Amsterdam is still 31 October in UTC: October is the month before.
    expect(parseArgs(["--step=draft"], new Date("2026-10-31T23:30:00Z")).period.start).toBe("2026-10-01");
    expect(parseArgs(["--step=draft"], new Date("2026-01-01T05:00:00Z")).period.start).toBe("2025-12-01");
  });

  test("reads the flags", () => {
    const args = parseArgs(["--step=draft", "--period=2026-09", "--dry-run", "--entity=org_1"], NOW);
    expect(args).toMatchObject({ step: "draft", dryRun: true, entity: "org_1", preview: false });
    expect(args.period.start).toBe("2026-09-01");
    expect(parseArgs(["--step=draft", "--entity=org_1", "--preview"], NOW).preview).toBe(true);
  });

  test("report needs a quarter", () => {
    expect(() => parseArgs(["--step=report"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=report", "--quarter=2026Q5"], NOW)).toThrow(ArgsError);
    expect(parseArgs(["--step=report", "--quarter=2026Q3"], NOW).quarter).toBe("2026Q3");
  });

  test("backfill needs --from and covers every month up to last month", () => {
    expect(() => parseArgs(["--step=backfill"], NOW)).toThrow(ArgsError);
    expect(months("2026-08")).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(months("2025-11", new Date("2026-02-01T10:00:00Z"))).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(months("2026-10")).toEqual(["2026-10"]);
    // The current month is not over yet.
    expect(() => parseArgs(["--step=backfill", "--from=2026-11"], NOW)).toThrow(ArgsError);
  });

  test("rejects an unknown step", () => {
    expect(() => parseArgs(["--step=publish"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs([], NOW)).toThrow(ArgsError);
  });

  test("rejects unknown flags and malformed values", () => {
    expect(() => parseArgs(["--step=draft", "--force"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=draft", "--period=2026-9"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=draft", "--period"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=draft", "draft"], NOW)).toThrow(ArgsError);
  });

  test("refuses a month that is not over", () => {
    expect(() => parseArgs(["--step=draft", "--period=2026-11"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=issue", "--period=2026-12"], NOW)).toThrow(ArgsError);
  });

  test("refuses flags the step has no use for", () => {
    expect(() => parseArgs(["--step=issue", "--dry-run"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=deliver", "--entity=org_1"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=draft", "--quarter=2026Q3"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=draft", "--from=2026-01"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=report", "--quarter=2026Q3", "--period=2026-09"], NOW)).toThrow(ArgsError);
  });

  test("a preview is of one host's draft", () => {
    expect(() => parseArgs(["--step=draft", "--preview"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=issue", "--preview", "--entity=org_1"], NOW)).toThrow(ArgsError);
    expect(() => parseArgs(["--step=draft", "--preview", "--entity=org_1", "--dry-run"], NOW)).toThrow(ArgsError);
  });
});

describe("amsterdamDate", () => {
  test("is the calendar date in Amsterdam", () => {
    expect(amsterdamDate(new Date("2026-11-08T09:00:00Z"))).toBe("2026-11-08");
    expect(amsterdamDate(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
    expect(amsterdamDate(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
  });
});
