import { getServerSession } from "@/lib/auth";
import { getBucket } from "@/lib/gcs";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import path from "path";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXT_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { fileName?: unknown; contentType?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { fileName, contentType } = body;

  if (typeof contentType !== "string" || !ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
  }

  if (typeof fileName !== "string" || !fileName) {
    return NextResponse.json({ error: "Invalid fileName" }, { status: 400 });
  }

  const ext = EXT_MAP[contentType] ?? path.extname(fileName).toLowerCase() ?? ".jpg";
  const gcsKey = `uploads/${randomUUID()}${ext}`;

  const file = getBucket().file(gcsKey);
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + 10 * 60 * 1000,
    contentType,
  });

  return NextResponse.json({ uploadUrl, gcsKey });
}
