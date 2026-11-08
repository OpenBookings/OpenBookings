import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { expect, test } from "bun:test";
import { createR2Store } from "./r2";

const ENV = {
  R2_ENDPOINT: "https://acct.eu.r2.cloudflarestorage.com",
  R2_ACCESS_KEY_ID: "AKIATEST",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_INVOICES_BUCKET_NAME: "invoices-test",
};

/** A client whose `send` records commands and answers from `reply`. */
function fakeClient(reply: (command: unknown) => unknown) {
  const sent: unknown[] = [];
  return {
    sent,
    client: {
      send: (async (command: unknown) => {
        sent.push(command);
        return reply(command);
      }) as never,
    },
  };
}

test("put sends the bucket, key, type and the sha256 as metadata", async () => {
  const fake = fakeClient(() => ({}));
  await createR2Store(ENV, fake.client).put("invoices/2026/a.pdf", new Uint8Array([1, 2]), "application/pdf", "abc123");

  const command = fake.sent[0] as PutObjectCommand;
  expect(command).toBeInstanceOf(PutObjectCommand);
  expect(command.input).toMatchObject({
    Bucket: "invoices-test",
    Key: "invoices/2026/a.pdf",
    ContentType: "application/pdf",
    Metadata: { sha256: "abc123" },
  });
});

test("head returns the sha256 metadata, null for no metadata, and null for a missing object", async () => {
  const hit = fakeClient(() => ({ Metadata: { sha256: "abc123" } }));
  expect(await createR2Store(ENV, hit.client).head("k")).toEqual({ sha256: "abc123" });
  expect(hit.sent[0]).toBeInstanceOf(HeadObjectCommand);

  const bare = fakeClient(() => ({}));
  expect(await createR2Store(ENV, bare.client).head("k")).toEqual({ sha256: null });

  const missing = {
    send: async () => {
      throw Object.assign(new Error("nope"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    },
  };
  expect(await createR2Store(ENV, missing as never).head("k")).toBeNull();

  const broken = {
    send: async () => {
      throw Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    },
  };
  await expect(createR2Store(ENV, broken as never).head("k")).rejects.toThrow("denied");
});

test("get returns the object's bytes", async () => {
  const fake = fakeClient(() => ({ Body: { transformToByteArray: async () => new Uint8Array([9, 8]) } }));
  expect(await createR2Store(ENV, fake.client).get("k")).toEqual(new Uint8Array([9, 8]));
  expect(fake.sent[0]).toBeInstanceOf(GetObjectCommand);
});

test("presign signs a download link that names the file and expires", async () => {
  const url = new URL(await createR2Store(ENV).presign("invoices/2026/OB-2026-0042.pdf", 300, 'OB-2026-0042".pdf'));

  expect(url.host).toBe("invoices-test.acct.eu.r2.cloudflarestorage.com");
  expect(url.pathname).toBe("/invoices/2026/OB-2026-0042.pdf");
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(url.searchParams.get("response-content-disposition")).toBe('attachment; filename="OB-2026-0042_.pdf"');
});

test("missing configuration is named", () => {
  expect(() => createR2Store({ ...ENV, R2_INVOICES_BUCKET_NAME: undefined })).toThrow("R2_INVOICES_BUCKET_NAME");
});
