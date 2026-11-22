import { describe, expect, test } from "bun:test";
import { presignUpload, uploadHeaders } from "./upload-headers";

describe("uploadHeaders", () => {
  test("sends exactly the content type", () => {
    expect(uploadHeaders("image/webp")).toEqual({ "Content-Type": "image/webp" });
  });

  test("every header the browser sends is one the URL signs", () => {
    for (const name of Object.keys(uploadHeaders("image/png"))) {
      expect(presignUpload.signableHeaders.has(name.toLowerCase())).toBe(true);
    }
  });
});
