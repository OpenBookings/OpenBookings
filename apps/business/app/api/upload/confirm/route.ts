import { getServerSession } from "@/lib/auth";
import { query, queryOne } from "@openbookings/db";
import { userOwnsRoom } from "@openbookings/authz";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  const session = await getServerSession();
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

  if (typeof gcsKey !== "string" || !gcsKey) {
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
