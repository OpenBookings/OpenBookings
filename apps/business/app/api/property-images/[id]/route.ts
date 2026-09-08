import { auth } from "@/lib/auth";
import { query, queryOne } from "@openbookings/db";
import { userOwnsProperty } from "@openbookings/authz";
import { NextResponse } from "next/server";

/** Resolve the image's owning property so ownership is checked, not assumed. */
async function ownedImage(session: Parameters<typeof userOwnsProperty>[0], imageId: string) {
  const row = await queryOne<{ property_id: string; group: string }>(
    `SELECT property_id, "group" FROM property_images WHERE id = $1`,
    [imageId],
  );
  if (!row) return null;
  return (await userOwnsProperty(session, row.property_id)) ? row : null;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const image = await ownedImage(session, id);
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { altText?: unknown; sortOrder?: unknown; group?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.altText === "string") {
    await query(`UPDATE property_images SET alt_text = $1 WHERE id = $2`, [
      body.altText.trim() || null,
      id,
    ]);
  }

  if (typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)) {
    await query(`UPDATE property_images SET sort_order = $1 WHERE id = $2`, [body.sortOrder, id]);
  }

  // "Set as hero": the incoming image becomes the hero and the outgoing one
  // rejoins the gallery, so the property never has two heroes or none.
  if (body.group === "hero-image") {
    await query(
      `UPDATE property_images SET "group" = 'gallery'
       WHERE property_id = $1 AND "group" = 'hero-image'`,
      [image.property_id],
    );
    await query(`UPDATE property_images SET "group" = 'hero-image' WHERE id = $1`, [id]);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const image = await ownedImage(session, id);
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The stored object is deliberately left in place: an accidental delete should
  // cost a database row, not the host's only copy of a photograph.
  await query(`DELETE FROM property_images WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
