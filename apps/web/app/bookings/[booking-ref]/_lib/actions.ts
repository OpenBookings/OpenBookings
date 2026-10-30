'use server';

import { revalidatePath } from 'next/cache';
import { queryOne } from '@openbookings/db';
import { cancelRooms, previewRefund, type LifecycleResult } from '@openbookings/db/booking-lifecycle';
import { refundPayment } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in guest, only if the booking is theirs. Checked on every call. */
async function owner(bookingId: string): Promise<string | null> {
  const session = await getServerSession();
  if (!session || !UUID.test(bookingId)) return null;
  const row = await queryOne<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM bookings WHERE id = $1::uuid AND user_id = $2`,
    [bookingId, session.user.id],
  );
  return row?.ok ? session.user.id : null;
}

/** What cancelling these rooms (null = every active room) would refund right now. */
export async function guestPreviewCancel(bookingId: string, reservationIds: string[] | null) {
  if (!(await owner(bookingId))) return null;
  const preview = await previewRefund({ bookingId, reservationIds });
  if (!preview) return null;
  const paid = await queryOne<{ paid: number }>(
    `SELECT COALESCE(SUM(
       (SELECT SUM((n->>'price')::numeric + (n->>'touristTax')::numeric) FROM jsonb_array_elements(r.nights) n)
     ), 0)::float8 AS paid
     FROM reservations r
     WHERE r.booking_id = $1::uuid AND r.cancelled_at IS NULL
       AND ($2::uuid[] IS NULL OR r.id = ANY($2::uuid[]))`,
    [bookingId, reservationIds],
  );
  return { refund: preview.total, retained: Math.round(((paid?.paid ?? 0) - preview.total) * 100) / 100 };
}

export async function guestCancelRooms(bookingId: string, reservationIds: string[] | null): Promise<LifecycleResult> {
  const userId = await owner(bookingId);
  if (!userId) return { ok: false, error: 'not_found' };
  const result = await cancelRooms(
    { refund: refundPayment },
    { bookingId, actor: { kind: 'guest', userId }, reservationIds },
  );
  revalidatePath(`/bookings/${bookingId}`);
  return result;
}
