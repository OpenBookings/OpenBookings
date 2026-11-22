import { beforeEach, describe, expect, test } from "bun:test";
import { mockModules } from "@/lib/mock-modules";
import { buildUploadKey } from "@/lib/upload-policy";

const sent: { name: string; input: Record<string, unknown> }[] = [];
const queries: string[] = [];
let head: { ContentType?: string; ContentLength?: number } | null = null;

await mockModules(
  import.meta.dir,
  {
    "@/lib/auth": () => ({ getServerSession: async () => ({ user: { id: "host-1" }, session: { id: "s1" } }) }),
    "@/lib/s3": () => ({
      getBucketName: () => "media",
      publicUrl: (key: string) => `https://cdn.test/${key}`,
      getS3: () => ({
        send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
          sent.push({ name: cmd.constructor.name, input: cmd.input });
          if (cmd.constructor.name === "HeadObjectCommand") {
            if (!head) throw new Error("NotFound");
            return head;
          }
          return {};
        },
      }),
    }),
    "@/lib/current-property": () => ({ currentPropertyPin: async () => null }),
    "@/lib/purge-property-page": () => ({ purgePropertyPage: async () => {} }),
    "@openbookings/authz": () => ({ userOwnsRoom: async () => true, userOwnsProperty: async () => true }),
    "@openbookings/db": () => ({
      query: async (text: string) => {
        queries.push(text);
        return [];
      },
      queryOne: async () => null,
    }),
  },
  ["@/lib/auth"],
);

const { POST } = await import("./route");

const key = buildUploadKey("host-1", "image/png", "0b0e5b55-1d6a-4c3e-9a51-6f1d1a2b3c4d")!;

const confirm = () =>
  POST(
    new Request("http://localhost/api/upload/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, roomId: "room-1" }),
    }),
  );

describe("POST /api/upload/confirm", () => {
  beforeEach(() => {
    sent.length = 0;
    queries.length = 0;
  });

  test("an object that is not an allowed image is deleted from the bucket and refused", async () => {
    for (const bad of [
      { ContentType: "text/html", ContentLength: 42 },
      { ContentType: "image/svg+xml", ContentLength: 42 },
      { ContentType: "image/png", ContentLength: 0 },
      { ContentType: "image/png", ContentLength: 11 * 1024 * 1024 },
    ]) {
      sent.length = 0;
      head = bad;
      const res = await confirm();
      expect(res.status).toBe(400);
      expect(sent.map((s) => s.name)).toEqual(["HeadObjectCommand", "DeleteObjectCommand"]);
      expect(sent[1].input).toEqual({ Bucket: "media", Key: key });
    }
    expect(queries).toEqual([]);
  });

  test("a good image is kept and stored", async () => {
    head = { ContentType: "image/png", ContentLength: 42 };
    const res = await confirm();
    expect(res.status).toBe(200);
    expect(sent.map((s) => s.name)).toEqual(["HeadObjectCommand"]);
    expect(queries.some((q) => q.includes("INSERT INTO room_images"))).toBe(true);
  });

  test("a missing object deletes nothing", async () => {
    head = null;
    const res = await confirm();
    expect(res.status).toBe(400);
    expect(sent.map((s) => s.name)).toEqual(["HeadObjectCommand"]);
  });
});
