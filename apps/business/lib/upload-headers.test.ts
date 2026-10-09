import { describe, expect, test } from "bun:test";
import { UPLOAD_CACHE_CONTROL, uploadHeaders } from "./upload-headers";

describe("uploadHeaders", () => {
  test("carries the content type and a one-year immutable cache policy", () => {
    expect(uploadHeaders("image/webp")).toEqual({
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  test("the cache policy is the exported constant, so the signature and the PUT cannot drift", () => {
    expect(uploadHeaders("image/png")["Cache-Control"]).toBe(UPLOAD_CACHE_CONTROL);
  });
});
