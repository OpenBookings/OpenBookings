import { createHash } from "node:crypto";

/**
 * Rules for host image uploads (R2), shared by /api/upload/presign and
 * /api/upload/confirm so the two cannot drift apart.
 */

/** Matches the 10 MB the upload widgets already advertise (image-manager). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const ALLOWED_TYPES = new Set(Object.keys(EXT_BY_TYPE));

/**
 * A stable, non-reversible tag for "this host's uploads". Not the user id
 * itself: the key ends up in a public image URL, and the id is used elsewhere
 * as an analytics identifier.
 */
export function uploadOwnerTag(userId: string): string {
  return createHash("sha256").update(`upload-owner:${userId}`).digest("hex").slice(0, 16);
}

/** `uploads/<ownerTag>/<uuid>.<ext>` */
export function buildUploadKey(userId: string, contentType: string, uuid: string): string | null {
  const ext = EXT_BY_TYPE[contentType];
  return ext ? `uploads/${uploadOwnerTag(userId)}/${uuid}.${ext}` : null;
}

const KEY_RE =
  /^uploads\/([0-9a-f]{16})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/**
 * Whether `key` has exactly the shape presign hands out AND was issued for
 * this user. A key is public the moment its image is shown on a listing, so
 * knowing one is not evidence of having uploaded it: without the owner check,
 * any host could attach another host's photo to their own property.
 */
export function uploadKeyBelongsTo(key: unknown, userId: string): key is string {
  if (typeof key !== "string") return false;
  const m = KEY_RE.exec(key);
  return m !== null && m[1] === uploadOwnerTag(userId);
}

/** What the presign body must contain: the size the browser is about to PUT. */
export function validUploadSize(size: unknown): size is number {
  return typeof size === "number" && Number.isInteger(size) && size > 0 && size <= MAX_UPLOAD_BYTES;
}

export type UploadedObject = { contentLength?: number | null; contentType?: string | null };

/**
 * Judge what is actually in the bucket, not what the browser claimed. The
 * signed Content-Length pins the size at presign time, but the type header is
 * not part of what R2 verifies, so a .png key can hold anything: check it here.
 */
export function uploadedObjectProblem(head: UploadedObject): string | null {
  const size = head.contentLength;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return "Uploaded file is empty";
  if (size > MAX_UPLOAD_BYTES) return "Uploaded file is too large";
  const type = head.contentType?.split(";")[0].trim().toLowerCase();
  if (!type || !ALLOWED_TYPES.has(type)) return "Uploaded file is not a supported image type";
  return null;
}
