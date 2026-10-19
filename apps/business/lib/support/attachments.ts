/**
 * Upload limits for support attachments: images and PDF, at most 5 files of
 * 10 MB each. Checked in the browser (an error on the chip before upload)
 * and again on the server.
 */
export const ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxBytes: 10 * 1024 * 1024,
  types: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "application/pdf"],
} as const;

export const ATTACHMENT_ACCEPT = ATTACHMENT_LIMITS.types.join(",");

/** Why a file can't be attached, or null when it can. */
export function attachmentProblem(file: { name: string; type: string; size: number }): string | null {
  if (!(ATTACHMENT_LIMITS.types as readonly string[]).includes(file.type)) {
    return "Only images and PDF files can be attached.";
  }
  if (file.size > ATTACHMENT_LIMITS.maxBytes) return "Larger than 10 MB.";
  return null;
}
