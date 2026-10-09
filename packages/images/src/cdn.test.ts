import { describe, expect, test } from "bun:test";
import { cdnImageSrcSet, cdnImageUrl, isTransformable } from "./cdn";

const PHOTO = "https://cdn.openbookings.co/uploads/abc.jpg";
const OPTS = "format=auto,fit=scale-down,onerror=redirect";

describe("cdnImageUrl", () => {
  test("rewrites a CDN photo into a resizing URL", () => {
    expect(cdnImageUrl(PHOTO, { width: 960 })).toBe(
      `https://cdn.openbookings.co/cdn-cgi/image/width=960,quality=75,${OPTS}/uploads/abc.jpg`,
    );
  });

  test("uses the given quality", () => {
    expect(cdnImageUrl(PHOTO, { width: 480, quality: 40 })).toBe(
      `https://cdn.openbookings.co/cdn-cgi/image/width=480,quality=40,${OPTS}/uploads/abc.jpg`,
    );
  });

  test("keeps a query string on the source", () => {
    expect(cdnImageUrl(`${PHOTO}?v=2`, { width: 96 })).toBe(
      `https://cdn.openbookings.co/cdn-cgi/image/width=96,quality=75,${OPTS}/uploads/abc.jpg?v=2`,
    );
  });

  test("rounds a fractional width", () => {
    expect(cdnImageUrl(PHOTO, { width: 255.6 })).toContain("width=256,");
  });

  test.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns the source untouched for width %p",
    (width) => {
      expect(cdnImageUrl(PHOTO, { width })).toBe(PHOTO);
    },
  );

  test.each([
    ["an AVIF source", "https://cdn.openbookings.co/Public/backgrounds/France-Paris.avif"],
    ["an uppercase AVIF extension", "https://cdn.openbookings.co/x/photo.AVIF"],
    ["an SVG source", "https://cdn.openbookings.co/Public/x/logo.svg"],
    ["an SVG with a query string", "https://cdn.openbookings.co/Public/x/logo.SVG?v=1"],
    ["an already transformed URL", `https://cdn.openbookings.co/cdn-cgi/image/width=96,${OPTS}/uploads/abc.jpg`],
    ["another host", "https://lh3.googleusercontent.com/a/abc=s96-c"],
    ["a lookalike host", "https://cdn.openbookings.co.evil.example/uploads/abc.jpg"],
    ["a protocol-relative URL", "//cdn.openbookings.co/uploads/abc.jpg"],
    ["a local public file", "/OB-LOGO-LIGHT.png"],
    ["a blob URL", "blob:https://business.openbookings.co/1b2c"],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["an empty string", ""],
  ])("passes %s through unchanged", (_label, src) => {
    expect(cdnImageUrl(src, { width: 960 })).toBe(src);
    expect(isTransformable(src)).toBe(false);
  });
});

describe("cdnImageSrcSet", () => {
  test("lists one candidate per width", () => {
    expect(cdnImageSrcSet(PHOTO, [960, 1920])).toBe(
      `https://cdn.openbookings.co/cdn-cgi/image/width=960,quality=75,${OPTS}/uploads/abc.jpg 960w, ` +
        `https://cdn.openbookings.co/cdn-cgi/image/width=1920,quality=75,${OPTS}/uploads/abc.jpg 1920w`,
    );
  });

  test("is undefined for a source that cannot be resized, so no srcSet is rendered", () => {
    expect(cdnImageSrcSet("/OB-LOGO-LIGHT.png", [960, 1920])).toBeUndefined();
  });
});
