import { auth } from "@/lib/auth";
import { query, queryOne } from "@openbookings/db";
import { userOwnsProperty, userOwnsRoom } from "@openbookings/authz";
import { publicUrl } from "@/lib/s3";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

const IMAGE_GROUPS = new Set(["hero-image", "logo", "gallery"]);

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { key?: unknown; roomId?: unknown; propertyId?: unknown; group?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { key, roomId, propertyId, group } = body;

  if (typeof key !== "string" || !key) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  const url = publicUrl(key);

  // Room target — unchanged behaviour.
  if (typeof roomId === "string" && roomId) {
    if (!(await userOwnsRoom(session, roomId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const maxRow = await queryOne<{ max_order: number | null }>(
      `SELECT MAX(sort_order) AS max_order FROM room_images WHERE room_id = $1`,
      [roomId],
    );
    const id = randomUUID();
    await query(
      `INSERT INTO room_images (id, room_id, url, sort_order) VALUES ($1, $2, $3, $4)`,
      [id, roomId, url, (maxRow?.max_order ?? -1) + 1],
    );
    return NextResponse.json({ id, url });
  }

  // Property target.
  if (typeof propertyId === "string" && propertyId) {
    if (typeof group !== "string" || !IMAGE_GROUPS.has(group)) {
      return NextResponse.json({ error: "Invalid group" }, { status: 400 });
    }
    if (!(await userOwnsProperty(session, propertyId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Hero and logo are singular: a second upload replaces the first rather
    // than silently stacking two rows the listing page would pick between.
    if (group === "hero-image" || group === "logo") {
      await query(`DELETE FROM property_images WHERE property_id = $1 AND "group" = $2`, [
        propertyId,
        group,
      ]);
    }

    const maxRow = await queryOne<{ max_order: number | null }>(
      `SELECT MAX(sort_order) AS max_order FROM property_images WHERE property_id = $1 AND "group" = $2`,
      [propertyId, group],
    );
    const id = randomUUID();
    await query(
      `INSERT INTO property_images (id, property_id, url, "group", sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, propertyId, url, group, (maxRow?.max_order ?? -1) + 1],
    );
    return NextResponse.json({ id, url, group });
  }

  return NextResponse.json({ error: "Provide either roomId or propertyId" }, { status: 400 });
}
