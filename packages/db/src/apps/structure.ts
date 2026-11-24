/** The property's rooms and rate plans as an app sees them, by their public channel codes (0060). */
import type { AppStructure } from "@openbookings/apps-contract";
import type { Queryable } from "../reservation-policy";
import type { Installation } from "./installations";

type StructureRow = {
  property_code: string;
  property_name: string;
  timezone: string;
  room_code: string | null;
  room_name: string;
  base_occupancy: number;
  max_adults: number;
  max_children: number;
  plan_code: string | null;
  plan_name: string;
  is_refundable: boolean;
  includes_breakfast: boolean;
  includes_lunch: boolean;
  includes_dinner: boolean;
};

/** Active, non-archived rooms and rate plans, in the host's order (`sort_order`, then name). */
export async function loadAppStructure(db: Queryable, installation: Installation): Promise<AppStructure> {
  const rows = (
    await db.query(
      `SELECT p.channel_code AS property_code, p.name AS property_name, p.timezone,
              r.channel_code AS room_code, r.name AS room_name,
              r.base_occupancy, r.max_adults, r.max_children,
              rp.channel_code AS plan_code, rp.name AS plan_name, rp.is_refundable,
              rp.includes_breakfast, rp.includes_lunch, rp.includes_dinner
         FROM properties p
         LEFT JOIN rooms r ON r.property_id = p.id AND r.is_active AND r.archived_at IS NULL
         LEFT JOIN rate_plans rp ON rp.room_id = r.id AND rp.is_active AND rp.archived_at IS NULL
        WHERE p.id = $1::uuid
        ORDER BY r.sort_order, r.name, r.id, rp.sort_order, rp.name, rp.id`,
      [installation.propertyId],
    )
  ).rows as StructureRow[];
  const first = rows[0];
  if (!first) throw new Error(`Property ${installation.propertyId} not found`);

  const rooms: AppStructure["rooms"] = [];
  for (const row of rows) {
    if (row.room_code === null) continue;
    let room = rooms[rooms.length - 1];
    if (!room || room.code !== row.room_code) {
      room = {
        code: row.room_code,
        name: row.room_name,
        baseOccupancy: row.base_occupancy,
        maxAdults: row.max_adults,
        maxChildren: row.max_children,
        ratePlans: [],
      };
      rooms.push(room);
    }
    if (row.plan_code !== null) {
      room.ratePlans.push({
        code: row.plan_code,
        name: row.plan_name,
        isRefundable: row.is_refundable,
        includesBreakfast: row.includes_breakfast,
        includesLunch: row.includes_lunch,
        includesDinner: row.includes_dinner,
      });
    }
  }
  return { propertyCode: first.property_code, propertyName: first.property_name, timezone: first.timezone, rooms };
}
