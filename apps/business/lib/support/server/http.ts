import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { currentSupportScope } from "./bootstrap";
import { SupportError } from "./service";
import type { SupportScope } from "./tickets";

/**
 * Shared wrapper for the support route handlers (the two endpoints that take
 * uploads, which server actions cap at 1 MB). Same contract as the server
 * actions: `{ ok: true, data }` or `{ ok: false, error }` with a safe message.
 */
export async function supportRoute<T>(
  limit: { key: string; max: number; windowMs: number },
  fn: (scope: SupportScope) => Promise<T>,
): Promise<NextResponse> {
  const scope = await currentSupportScope();
  if (!scope) return NextResponse.json({ ok: false, error: "Support isn't available right now." }, { status: 404 });
  const check = checkRateLimit(`${limit.key}:${scope.userId}`, limit.max, limit.windowMs);
  if (!check.allowed) {
    return NextResponse.json({ ok: false, error: "You're going a bit fast. Please wait a moment." }, { status: 429 });
  }
  try {
    return NextResponse.json({ ok: true, data: await fn(scope) });
  } catch (err) {
    if (err instanceof SupportError) return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    console.error("[support] route failed:", err);
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export function formString(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function formFiles(form: FormData): File[] {
  return form.getAll("files").filter((v): v is File => typeof v !== "string" && v.size > 0);
}

/** Parse multipart, turning a malformed body into a host-safe error. */
export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new SupportError("The upload didn't arrive in one piece. Please try again.");
  }
}
