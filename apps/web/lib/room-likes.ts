"use server";

import { revalidatePath } from "next/cache";
import { query } from "@openbookings/db";
import { getServerSession } from "@/lib/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRoomId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

export type LikeResult = { ok: true } | { ok: false; reason: "signed-out" | "failed" };

/**
 * Which of `roomIds` the signed-in guest has liked. Empty when signed out, so
 * the listing page can stay cached and ask for this from the browser.
 */
export async function likedRoomIds(roomIds: string[]): Promise<string[]> {
  const ids = Array.isArray(roomIds) ? roomIds.filter(isRoomId).slice(0, 200) : [];
  if (ids.length === 0) return [];
  const session = await getServerSession();
  if (!session) return [];
  const rows = await query<{ room_id: string }>(
    `SELECT room_id FROM guest_room_likes WHERE user_id = $1 AND room_id = ANY($2::uuid[])`,
    [session.user.id, ids],
  );
  return rows.map((r) => r.room_id);
}

/** Likes or unlikes one room for the signed-in guest. Both are idempotent. */
export async function setRoomLike(roomId: string, liked: boolean): Promise<LikeResult> {
  if (!isRoomId(roomId)) return { ok: false, reason: "failed" };
  const session = await getServerSession();
  if (!session) return { ok: false, reason: "signed-out" };
  try {
    if (liked) {
      // Only rooms a guest can see on a listing can be liked.
      await query(
        `INSERT INTO guest_room_likes (user_id, room_id)
         SELECT $1, r.id FROM rooms r JOIN properties p ON p.id = r.property_id
         WHERE r.id = $2 AND r.is_active AND p.is_active
         ON CONFLICT DO NOTHING`,
        [session.user.id, roomId],
      );
    } else {
      await query(`DELETE FROM guest_room_likes WHERE user_id = $1 AND room_id = $2`, [session.user.id, roomId]);
    }
  } catch {
    return { ok: false, reason: "failed" };
  }
  revalidatePath("/account/likes");
  return { ok: true };
}
