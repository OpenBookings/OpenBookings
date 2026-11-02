/** One conversation in the guest's inbox (GUEST_THREADS_SQL). */
export type GuestThreadItem = {
  id: string;
  status: string;
  updated_at: string;
  booking_id: string | null;
  property_name: string;
  property_city: string;
  /** The property's local date, YYYY-MM-DD; the stay countdown counts from it. */
  property_today: string;
  property_image: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  last_message_body: string | null;
  last_message_at: string | null;
  last_message_sender_role: "host" | "guest" | null;
  unread_count: number;
};

/**
 * The guest's conversations, newest activity first. Scoped to `$1`, the
 * session's user id; unread counts only messages the host sent.
 */
export const GUEST_THREADS_SQL = `
  SELECT
    t.id,
    t.status,
    t.updated_at,
    t.booking_id,
    p.name AS property_name,
    p.city AS property_city,
    (now() AT TIME ZONE p.timezone)::date::text AS property_today,
    (
      SELECT pi.url FROM property_images pi
      WHERE pi.property_id = p.id
      ORDER BY (CASE WHEN pi."group" = 'hero-image' THEN 0 ELSE 1 END), pi.sort_order, pi.created_at
      LIMIT 1
    ) AS property_image,
    b.check_in_date::text AS check_in_date,
    b.check_out_date::text AS check_out_date,
    lm.body AS last_message_body,
    lm.created_at AS last_message_at,
    lm.sender_role AS last_message_sender_role,
    COALESCE(unread.count, 0)::int AS unread_count
  FROM message_threads t
  JOIN properties p ON p.id = t.property_id
  LEFT JOIN bookings b ON b.id = t.booking_id
  LEFT JOIN LATERAL (
    SELECT body, created_at, sender_role FROM messages m
    WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS count FROM messages m
    WHERE m.thread_id = t.id AND m.sender_role = 'host' AND m.read_at IS NULL
  ) unread ON true
  WHERE t.guest_id = $1
  ORDER BY COALESCE(lm.created_at, t.updated_at) DESC
`;
