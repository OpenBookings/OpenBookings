import { auth } from "@/lib/auth";
import { query, queryOne } from "@openbookings/db";
import { userOwnsRoom } from "@openbookings/authz";
import { purgePropertyPage } from "@/lib/purge-property-page";
import { NextResponse } from "next/server";

/**
 * Edit and remove one room photo. The room twin of /api/property-images/[id]:
 * same ownership rule (resolve the photo's room, then ask authz), same body.
 * Uploads still go through /api/upload/presign and /api/upload/confirm.
 */

/** Resolve the image's owning room so ownership is checked, not assumed. */
async function ownedImage(session: Parameters<typeof userOwnsRoom>[0], imageId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) return null;
  const row = await queryOne<{ room_id: string }>(
    `SELECT ri.room_id FROM room_images ri
     JOIN rooms r ON r.id = ri.room_id
     WHERE ri.id = $1 AND r.archived_at IS NULL`,
    [imageId],
  );
  if (!row) return null;
  return (await userOwnsRoom(session, row.room_id)) ? row : null;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const image = await ownedImage(session, id);
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { altText?: unknown; sortOrder?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.altText === "string") {
    await query(`UPDATE room_images SET alt_text = $1 WHERE id = $2`, [
      body.altText.trim().slice(0, 500) || null,
      id,
    ]);
  }

  // smallint: refuse anything the column would reject rather than 500.
  if (
    typeof body.sortOrder === "number" &&
    Number.isInteger(body.sortOrder) &&
    body.sortOrder >= 0 &&
    body.sortOrder <= 32767
  ) {
    await query(`UPDATE room_images SET sort_order = $1 WHERE id = $2`, [body.sortOrder, id]);
  }

  await purgePropertyPage({ roomId: image.room_id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const image = await ownedImage(session, id);
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The stored object is deliberately left in place, as for property photos:
  // an accidental delete should cost a database row, not the only copy.
  await query(`DELETE FROM room_images WHERE id = $1`, [id]);
  await purgePropertyPage({ roomId: image.room_id });
  return NextResponse.json({ ok: true });
}
