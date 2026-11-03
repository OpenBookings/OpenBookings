import { describe, expect, test } from "bun:test";
import {
  MAX_UPLOAD_BYTES,
  buildUploadKey,
  uploadKeyBelongsTo,
  uploadOwnerTag,
  uploadedObjectProblem,
  validUploadSize,
} from "./upload-policy";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("upload keys", () => {
  test("a key issued for a user belongs to that user and nobody else", () => {
    const key = buildUploadKey("user-a", "image/png", UUID)!;
    expect(key).toBe(`uploads/${uploadOwnerTag("user-a")}/${UUID}.png`);
    expect(uploadKeyBelongsTo(key, "user-a")).toBe(true);
    expect(uploadKeyBelongsTo(key, "user-b")).toBe(false);
  });

  test("the user id is not readable from the key", () => {
    expect(buildUploadKey("user-a", "image/png", UUID)).not.toContain("user-a");
  });

  test("no key for a type that is not an allowed image", () => {
    expect(buildUploadKey("user-a", "image/svg+xml", UUID)).toBeNull();
    expect(buildUploadKey("user-a", "text/html", UUID)).toBeNull();
  });

  test("rejects the old unowned shape, traversal, queries and non-strings", () => {
    const tag = uploadOwnerTag("user-a");
    for (const key of [
      `uploads/${UUID}.png`,
      `uploads/${tag}/../${UUID}.png`,
      `uploads/${tag}/${UUID}.png?x=1`,
      `uploads/${tag}/${UUID}.png#x`,
      `uploads/${tag}/${UUID}.svg`,
      `uploads/${tag}/${UUID}.png/extra`,
      `other/${tag}/${UUID}.png`,
      undefined,
      null,
      42,
    ]) {
      expect(uploadKeyBelongsTo(key, "user-a")).toBe(false);
    }
  });
});

describe("validUploadSize", () => {
  test("accepts 1 byte up to the limit", () => {
    expect(validUploadSize(1)).toBe(true);
    expect(validUploadSize(MAX_UPLOAD_BYTES)).toBe(true);
  });
  test("rejects zero, over the limit, fractions, NaN, Infinity and non-numbers", () => {
    for (const size of [0, -1, MAX_UPLOAD_BYTES + 1, 1.5, Number.NaN, Infinity, "100", null, undefined]) {
      expect(validUploadSize(size)).toBe(false);
    }
  });
});

describe("uploadedObjectProblem", () => {
  test("a normal image is fine", () => {
    expect(uploadedObjectProblem({ contentLength: 2048, contentType: "image/jpeg" })).toBeNull();
    expect(uploadedObjectProblem({ contentLength: 2048, contentType: "image/webp; charset=binary" })).toBeNull();
  });
  test("empty, oversize or missing size is refused", () => {
    expect(uploadedObjectProblem({ contentLength: 0, contentType: "image/png" })).toMatch(/empty/);
    expect(uploadedObjectProblem({ contentLength: MAX_UPLOAD_BYTES + 1, contentType: "image/png" })).toMatch(/too large/);
    expect(uploadedObjectProblem({ contentType: "image/png" })).toMatch(/empty/);
  });
  test("a stored type other than the allowed images is refused", () => {
    expect(uploadedObjectProblem({ contentLength: 10, contentType: "text/html" })).toMatch(/supported/);
    expect(uploadedObjectProblem({ contentLength: 10, contentType: "image/svg+xml" })).toMatch(/supported/);
    expect(uploadedObjectProblem({ contentLength: 10, contentType: null })).toMatch(/supported/);
  });
});
