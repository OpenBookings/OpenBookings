import { auth } from "@/lib/auth";
import { query, queryOne } from "@openbookings/db";
import { NextResponse } from "next/server";
import type { ThreadRow } from "@openbookings/authz";

type BookingRow = { id: string; hotel_id: string; user_id: string };
type PropertyRow = { id: string; owner_user_id: string | null };

/**
 * Creates (or returns the existing) thread for a booking, or a pre-booking
 * property inquiry. Idempotent: re-posting the same booking/property
 * returns the same thread rather than creating a duplicate.
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { bookingId?: unknown; propertyId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { bookingId, propertyId } = body;
  if (bookingId !== undefined && typeof bookingId !== "string") {
    return NextResponse.json({ error: "Invalid bookingId" }, { status: 400 });
  }
  if (propertyId !== undefined && typeof propertyId !== "string") {
    return NextResponse.json({ error: "Invalid propertyId" }, { status: 400 });
  }
  if (!!bookingId === !!propertyId) {
    return NextResponse.json({ error: "Provide exactly one of bookingId or propertyId" }, { status: 400 });
  }

  const userId = session.user.id;
  let hostId: string;
  let guestId: string;
  let resolvedPropertyId: string;

  if (bookingId) {
    const booking = await queryOne<BookingRow>(
      `SELECT id, hotel_id, user_id FROM bookings WHERE id = $1`,
      [bookingId],
    );
    if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const property = await queryOne<PropertyRow>(
      `SELECT id, owner_user_id FROM properties WHERE id = $1`,
      [booking.hotel_id],
    );
    if (!property?.owner_user_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (userId !== property.owner_user_id && userId !== booking.user_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    hostId = property.owner_user_id;
    guestId = booking.user_id;
    resolvedPropertyId = property.id;
  } else {
    const property = await queryOne<PropertyRow>(
      `SELECT id, owner_user_id FROM properties WHERE id = $1 AND is_active = true`,
      [propertyId],
    );
    if (!property?.owner_user_id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (userId === property.owner_user_id) {
      return NextResponse.json({ error: "Hosts cannot open an inquiry on their own property" }, { status: 400 });
    }

    hostId = property.owner_user_id;
    guestId = userId;
    resolvedPropertyId = property.id;
  }

  const existing = await queryOne<ThreadRow>(
    bookingId
      ? `SELECT * FROM message_threads WHERE booking_id = $1`
      : `SELECT * FROM message_threads WHERE booking_id IS NULL AND property_id = $1 AND host_id = $2 AND guest_id = $3`,
    bookingId ? [bookingId] : [resolvedPropertyId, hostId, guestId],
  );
  if (existing) return NextResponse.json({ thread: existing });

  const [thread] = await query<ThreadRow>(
    `INSERT INTO message_threads (booking_id, property_id, host_id, guest_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [bookingId ?? null, resolvedPropertyId, hostId, guestId],
  );

  return NextResponse.json({ thread }, { status: 201 });
}
