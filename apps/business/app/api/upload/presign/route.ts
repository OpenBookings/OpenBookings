import { auth } from "@/lib/auth";
import { getBucketName, getS3 } from "@/lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
  const session = await auth.api.getSession({ headers: req.headers });
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
  const key = `uploads/${randomUUID()}${ext}`;

  // ContentType is signed in, so the browser's PUT must send the same header or
  // Scaleway rejects the signature.
  const uploadUrl = await getSignedUrl(
    getS3(),
    new PutObjectCommand({ Bucket: getBucketName(), Key: key, ContentType: contentType }),
    { expiresIn: 600 },
  );

  return NextResponse.json({ uploadUrl, key });
}
