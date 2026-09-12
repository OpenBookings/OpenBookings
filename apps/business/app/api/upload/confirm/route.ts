import { auth } from "@/lib/auth";
import { query, queryOne } from "@openbookings/db";
import { userOwnsRoom } from "@openbookings/authz";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

/**
 * The exact shape /api/upload/presign hands out: `uploads/<uuid><ext>` for one
 * of the three image types it will sign for.
 *
 * `gcsKey` arrives from the browser, so possession of it is not evidence that
 * this host uploaded it. Without this check the key is concatenated into a
 * public object URL and stored as a room image, which lets any authenticated
 * host point a room of their own at any other object in the bucket — including
 * another property's photos — and lets a crafted key ("../", a query string, a
 * fragment) shape the stored URL into something other than a bucket object.
 * Ownership of the *room* is checked below; this checks the *key*.
 */
const GCS_KEY_RE =
  /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { gcsKey?: unknown; roomId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { gcsKey, roomId } = body;

  if (typeof gcsKey !== "string" || !GCS_KEY_RE.test(gcsKey)) {
    return NextResponse.json({ error: "Invalid gcsKey" }, { status: 400 });
  }
  if (typeof roomId !== "string" || !roomId) {
    return NextResponse.json({ error: "Invalid roomId" }, { status: 400 });
  }

  if (!(await userOwnsRoom(session, roomId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${gcsKey}`;

  const maxRow = await queryOne<{ max_order: number | null }>(
    `SELECT MAX(sort_order) AS max_order FROM room_images WHERE room_id = $1`,
    [roomId]
  );
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  const id = randomUUID();
  await query(
    `INSERT INTO room_images (id, room_id, url, sort_order)
     VALUES ($1, $2, $3, $4)`,
    [id, roomId, url, sortOrder]
  );

  return NextResponse.json({ id, url });
}
