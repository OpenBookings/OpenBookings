import { describe, expect, test } from "bun:test";
import { instrumentHtml, linkName } from "./instrument";

const PIXEL = "https://openbookings.co/e/o/TOKEN";
const seen: Array<[string, string]> = [];
const opts = {
  pixelUrl: PIXEL,
  isOwnUrl: (u: string) => new URL(u).host === "openbookings.co",
  trackedUrl: (d: string, n: string) => {
    seen.push([d, n]);
    return `https://openbookings.co/e/c/${n}|${d}`;
  },
};
const img = `<img src="${PIXEL}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />`;

describe("instrumentHtml", () => {
  test("rewrites own links", () => {
    const out = instrumentHtml(`<a href="https://openbookings.co/bookings/1">x</a>`, opts);
    expect(out).toContain(`href="https://openbookings.co/e/c/cta|https://openbookings.co/bookings/1"`);
  });

  test("decodes &amp; before passing the destination", () => {
    seen.length = 0;
    instrumentHtml(`<a href="https://openbookings.co/x?a=1&amp;b=2">x</a>`, opts);
    expect(seen[0]?.[0]).toBe("https://openbookings.co/x?a=1&b=2");
  });

  test("leaves mailto and foreign links alone", () => {
    const html = `<a href="mailto:support@openbookings.co">a</a><a href="https://dashboard.stripe.com">b</a>`;
    expect(instrumentHtml(html, opts).startsWith(html)).toBe(true);
  });

  test("names links by position and opt-out", () => {
    const out = instrumentHtml(
      `<a href="https://dashboard.stripe.com">s</a><a href="https://openbookings.co/a">1</a><a href="https://openbookings.co/b">2</a><a href="https://openbookings.co/review/abc/stop">3</a>`,
      opts,
    );
    expect(out).toContain("/e/c/cta|https://openbookings.co/a");
    expect(out).toContain("/e/c/link_2|https://openbookings.co/b");
    expect(out).toContain("/e/c/opt_out|https://openbookings.co/review/abc/stop");
  });

  test("inserts pixel before last </body> case-insensitively", () => {
    const out = instrumentHtml(`<html><body><p>hi</p></BODY></html>`, opts);
    expect(out).toBe(`<html><body><p>hi</p>${img}</BODY></html>`);
  });

  test("inserts pixel right before </body> when text changes length on lowercasing", () => {
    // "İ".toLowerCase() is two code units, so an index taken from a lowercased copy is off by one.
    const out = instrumentHtml(`<html><body><p>İstanbul İzmir</p></body></html>`, opts);
    expect(out).toBe(`<html><body><p>İstanbul İzmir</p>${img}</body></html>`);
  });

  test("appends pixel without </body>", () => {
    expect(instrumentHtml(`<p>hi</p>`, opts)).toBe(`<p>hi</p>${img}`);
  });

  test("does not touch img src", () => {
    const logo = `<img src="https://cdn.openbookings.co/logo.png" />`;
    expect(instrumentHtml(logo, opts).startsWith(logo)).toBe(true);
  });
});

describe("linkName", () => {
  test("names", () => {
    expect(linkName("https://openbookings.co/review/x/stop", 3)).toBe("opt_out");
    expect(linkName("https://openbookings.co/a", 0)).toBe("cta");
    expect(linkName("https://openbookings.co/a", 2)).toBe("link_3");
  });
});
