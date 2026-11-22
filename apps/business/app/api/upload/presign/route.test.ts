import { describe, expect, test } from "bun:test";
import { S3Client } from "@aws-sdk/client-s3";
import { mockModules } from "@/lib/mock-modules";

// Dummy R2: presigning is pure computation, nothing is sent anywhere.
const s3 = new S3Client({
  region: "auto",
  endpoint: "https://r2.test",
  forcePathStyle: true,
  credentials: { accessKeyId: "AKIDTEST", secretAccessKey: "secret-test" },
});

await mockModules(
  import.meta.dir,
  {
    "@/lib/auth": () => ({ auth: { api: {} }, getServerSession: async () => ({ user: { id: "host-1" }, session: { id: "s1" } }) }),
    "@/lib/s3": () => ({ getS3: () => s3, getBucketName: () => "media" }),
  },
  ["@/lib/auth"],
);

const { POST } = await import("./route");

async function presign(body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/upload/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as { uploadUrl?: string; key?: string } };
}

describe("POST /api/upload/presign", () => {
  test("the content type is a signed header, so the PUT cannot store a different one", async () => {
    const { status, json } = await presign({ fileName: "a.png", contentType: "image/png", size: 42 });
    expect(status).toBe(200);
    const url = new URL(json.uploadUrl!);
    const signed = url.searchParams.get("X-Amz-SignedHeaders")!.split(";");
    expect(signed).toContain("content-type");
    expect(signed).toContain("content-length");
    expect(signed).toContain("host");
  });

  test("the signature depends on the content type", async () => {
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { presignUpload } = await import("@/lib/upload-headers");
    const signingDate = new Date("2026-11-22T12:00:00Z");
    const sign = (ContentType: string) =>
      getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: "media", Key: "uploads/x.png", ContentType, ContentLength: 42 }),
        { ...presignUpload, signingDate },
      ).then((u) => new URL(u).searchParams.get("X-Amz-Signature"));
    const png = await sign("image/png");
    const html = await sign("text/html");
    expect(png).toBeTruthy();
    expect(png).not.toBe(html);
  });

  test("a type outside the image allowlist gets no URL", async () => {
    for (const contentType of ["text/html", "image/svg+xml", "application/javascript"]) {
      const { status, json } = await presign({ fileName: "a.png", contentType, size: 42 });
      expect(status).toBe(400);
      expect(json.uploadUrl).toBeUndefined();
    }
  });
});
