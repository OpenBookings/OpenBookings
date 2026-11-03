/** One row of GUEST_LIKES_SQL: a liked room and the hotel it belongs to. */
export type LikedRoomRow = {
  room_id: string;
  room_name: string;
  room_image_url: string | null;
  property_id: string;
  property_name: string;
  property_slug: string;
  city: string | null;
  property_image_url: string | null;
};

export type LikedHotel = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  imageUrl: string | null;
  rooms: { id: string; name: string; imageUrl: string | null }[];
};

export type LikesView = "hotel" | "room";

export const LIKES_VIEWS: { id: LikesView; title: string }[] = [
  { id: "room", title: "By room" },
  { id: "hotel", title: "By hotel" },
];

/** `?view=room` shows rooms under hotel headings; anything else is the default, by hotel. */
export function parseView(raw: string | string[] | undefined): LikesView {
  return raw === "room" ? "room" : "hotel";
}

/**
 * Every room one guest liked, newest like first. Rooms or hotels taken off
 * the site are left out (the like stays, and comes back if they return).
 * Scoped to `$1` (the session's user id) — nothing else filters this.
 */
export const GUEST_LIKES_SQL = `
  SELECT
    r.id AS room_id,
    r.name AS room_name,
    (
      SELECT ri.url FROM room_images ri
      WHERE ri.room_id = r.id
      ORDER BY ri.sort_order, ri.created_at
      LIMIT 1
    ) AS room_image_url,
    p.id AS property_id,
    p.name AS property_name,
    p.slug AS property_slug,
    p.city,
    (
      SELECT pi.url FROM property_images pi
      WHERE pi.property_id = p.id
      ORDER BY (CASE WHEN pi."group" = 'hero-image' THEN 0 ELSE 1 END), pi.sort_order, pi.created_at
      LIMIT 1
    ) AS property_image_url
  FROM guest_room_likes l
  JOIN rooms r ON r.id = l.room_id
  JOIN properties p ON p.id = r.property_id
  WHERE l.user_id = $1 AND r.is_active AND p.is_active
  ORDER BY l.created_at DESC, r.id
`;

/**
 * Groups liked rooms by hotel. Rows arrive newest first, so the hotel liked
 * most recently leads, and each hotel's rooms keep that order too.
 */
export function groupByHotel(rows: LikedRoomRow[]): LikedHotel[] {
  const hotels = new Map<string, LikedHotel>();
  for (const row of rows) {
    let hotel = hotels.get(row.property_id);
    if (!hotel) {
      hotel = {
        id: row.property_id,
        name: row.property_name,
        slug: row.property_slug,
        city: row.city,
        imageUrl: row.property_image_url,
        rooms: [],
      };
      hotels.set(row.property_id, hotel);
    }
    hotel.rooms.push({ id: row.room_id, name: row.room_name, imageUrl: row.room_image_url });
  }
  return [...hotels.values()];
}
