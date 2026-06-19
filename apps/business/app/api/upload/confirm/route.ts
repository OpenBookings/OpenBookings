import { auth } from "@/lib/auth";
import { query, queryOne } from "@openbookings/db";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

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

  if (typeof gcsKey !== "string" || !gcsKey) {
    return NextResponse.json({ error: "Invalid gcsKey" }, { status: 400 });
  }
  if (typeof roomId !== "string" || !roomId) {
    return NextResponse.json({ error: "Invalid roomId" }, { status: 400 });
  }

  const maxRow = await queryOne<{ max_order: number | null }>(
    `SELECT MAX(sort_order) AS max_order FROM room_images WHERE room_id = $1`,
    [roomId]
  );
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  const id = randomUUID();
  await query(
    `INSERT INTO room_images (id, room_id, gcs_key, sort_order, uploaded_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [id, roomId, gcsKey, sortOrder]
  );

  return NextResponse.json({ id, gcsKey });
}
