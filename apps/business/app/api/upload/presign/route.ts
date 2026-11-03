import { getServerSession } from "@/lib/auth";
import { getBucketName, getS3 } from "@/lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, buildUploadKey, validUploadSize } from "@/lib/upload-policy";

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { fileName?: unknown; contentType?: unknown; size?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { fileName, contentType, size } = body;

  if (typeof contentType !== "string" || !ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
  }

  if (typeof fileName !== "string" || !fileName) {
    return NextResponse.json({ error: "Invalid fileName" }, { status: 400 });
  }

  // The browser declares how many bytes it is about to PUT, and that exact
  // length is signed into the URL (content-length is a signed header), so R2
  // rejects a PUT of any other size. A presigned PUT cannot express "at most";
  // pinning the length is how a size cap is enforced here.
  if (!validUploadSize(size)) {
    return NextResponse.json(
      { error: `size must be between 1 and ${MAX_UPLOAD_BYTES} bytes` },
      { status: 400 },
    );
  }

  // The extension comes from the allowed type, never from the client's file
  // name, and the key carries a tag for this host so /api/upload/confirm can
  // tell whose upload it is.
  const key = buildUploadKey(session.user.id, contentType, randomUUID());
  if (!key) return NextResponse.json({ error: "Invalid content type" }, { status: 400 });

  // Note ContentType is NOT among the signed headers (only host and
  // content-length are), so the type is not enforced here: /api/upload/confirm
  // checks what actually landed in the bucket.
  const uploadUrl = await getSignedUrl(
    getS3(),
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    }),
    { expiresIn: 600 },
  );

  return NextResponse.json({ uploadUrl, key });
}
