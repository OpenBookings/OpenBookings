import type { Queryable } from "@openbookings/db";
import type { Actor } from "@openbookings/db/booking-lifecycle";
import { UUID_RE } from "./search";

export type ActAs = "guest" | "host";

/**
 * The real user an admin acts as: the booking's guest, or the property owner.
 * Every event the lifecycle writes for this actor is marked via "admin".
 * Null when the booking is missing or (host) the property has no owner user.
 */
export async function actorFor(db: Queryable, bookingId: string, as: ActAs): Promise<Actor | null> {
  if (as !== "guest" && as !== "host") return null;
  if (!UUID_RE.test(bookingId)) return null;
  const { rows } = await db.query(
    `SELECT b.user_id, p.owner_user_id
       FROM bookings b JOIN properties p ON p.id = b.hotel_id
      WHERE b.id = $1::uuid`,
    [bookingId],
  );
  const row = rows[0] as { user_id: string | null; owner_user_id: string | null } | undefined;
  if (!row) return null;
  const userId = as === "guest" ? row.user_id : row.owner_user_id;
  return userId ? { kind: as, userId, via: "admin" } : null;
}
