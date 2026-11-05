import type { Queryable } from "@openbookings/db";

export type QueryKind = "empty" | "uuid" | "id_prefix" | "payment_intent" | "email" | "text";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function classifyQuery(q: string): { kind: QueryKind; value: string } {
  const value = q.trim();
  if (!value) return { kind: "empty", value };
  if (UUID_RE.test(value)) return { kind: "uuid", value };
  if (/^[0-9a-f-]{8,35}$/i.test(value)) return { kind: "id_prefix", value: value.toLowerCase() };
  if (value.startsWith("pi_")) return { kind: "payment_intent", value };
  if (value.includes("@")) return { kind: "email", value };
  return { kind: "text", value };
}

const STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show", "checked_in"];

function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export type SearchInput = { q: string; status?: string; property?: string; from?: string; to?: string };

export type BookingSearchRow = {
  id: string;
  guestName: string | null;
  guestEmail: string | null;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  status: string;
  totalAmount: number;
  createdAt: Date;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function searchBookings(db: Queryable, input: SearchInput): Promise<BookingSearchRow[]> {
  const { kind, value } = classifyQuery(input.q);
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (kind === "uuid") {
    const p = add(value.toLowerCase());
    where.push(
      `(b.id = ${p}::uuid OR EXISTS (SELECT 1 FROM reservations r WHERE r.booking_id = b.id AND r.id = ${p}::uuid))`,
    );
  } else if (kind === "id_prefix") {
    const p = add(escapeLike(value));
    where.push(
      `(b.id::text LIKE ${p} || '%' ESCAPE '\\' OR EXISTS (SELECT 1 FROM reservations r WHERE r.booking_id = b.id AND r.id::text LIKE ${p} || '%' ESCAPE '\\'))`,
    );
  } else if (kind === "payment_intent") {
    where.push(`b.stripe_payment_intent_id = ${add(value)}`);
  } else if (kind === "email") {
    where.push(`lower(u.email) LIKE lower(${add(escapeLike(value))}) || '%' ESCAPE '\\'`);
  } else if (kind === "text") {
    const p = add(escapeLike(value));
    where.push(
      `(u.name ILIKE '%' || ${p} || '%' ESCAPE '\\' OR p.name ILIKE '%' || ${p} || '%' ESCAPE '\\' OR lower(u.email) LIKE lower(${p}) || '%' ESCAPE '\\')`,
    );
  }
  if (input.status && STATUSES.includes(input.status)) {
    where.push(`b.status = ${add(input.status)}::booking_status`);
  }
  if (input.property && UUID_RE.test(input.property)) where.push(`b.hotel_id = ${add(input.property)}::uuid`);
  if (input.from && isRealDate(input.from)) where.push(`b.check_in_date >= ${add(input.from)}::date`);
  if (input.to && isRealDate(input.to)) where.push(`b.check_in_date <= ${add(input.to)}::date`);

  const { rows } = await db.query(
    `SELECT b.id, u.name AS guest_name, u.email AS guest_email, p.name AS property_name,
            to_char(b.check_in_date, 'YYYY-MM-DD') AS check_in,
            to_char(b.check_out_date, 'YYYY-MM-DD') AS check_out,
            (SELECT count(*)::int FROM reservations r WHERE r.booking_id = b.id) AS rooms,
            b.status, b.total_amount, b.created_at
       FROM bookings b
       JOIN properties p ON p.id = b.hotel_id
       LEFT JOIN "user" u ON u.id = b.user_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY b.created_at DESC, b.id
      LIMIT 50`,
    params,
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    guestName: (r.guest_name as string | null) ?? null,
    guestEmail: (r.guest_email as string | null) ?? null,
    propertyName: r.property_name as string,
    checkIn: r.check_in as string,
    checkOut: r.check_out as string,
    rooms: r.rooms as number,
    status: r.status as string,
    totalAmount: Number(r.total_amount),
    createdAt: r.created_at as Date,
  }));
}
