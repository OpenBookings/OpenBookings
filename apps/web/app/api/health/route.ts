import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    code: 200,
    // The commit this image was built from, baked in at build time. Curling a
    // container endpoint directly is then enough to say what is running on it,
    // which is what makes a canary observable from outside.
    release: process.env.NEXT_PUBLIC_RELEASE_SHA ?? null,
  });
}
