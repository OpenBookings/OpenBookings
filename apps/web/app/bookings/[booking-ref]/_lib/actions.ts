'use server';

import { revalidatePath } from 'next/cache';
import { queryOne } from '@openbookings/db';
import { cancelRooms, previewRefund, type LifecycleResult } from '@openbookings/db/booking-lifecycle';
import * as Sentry from '@sentry/nextjs';
import { findRefundForRow, isDefiniteRefundFailure, refundPayment } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';
import { sendCancellation } from '@/lib/mailing/booking-mail';

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

/** What cancelling these rooms (null = every active room) would refund right now, in cents. */
export async function guestPreviewCancel(
  bookingId: string,
  reservationIds: string[] | null,
): Promise<{ refundCents: number; retainedCents: number } | null> {
  if (!(await owner(bookingId))) return null;
  const preview = await previewRefund({ bookingId, reservationIds });
  if (!preview) return null;
  const paid = await queryOne<{ paid_cents: string }>(
    `SELECT COALESCE(SUM(
       (SELECT SUM((n->>'priceCents')::bigint + COALESCE((n->>'touristTaxCents')::bigint, 0)) FROM jsonb_array_elements(r.nights) n)
     ), 0)::bigint AS paid_cents
     FROM reservations r
     WHERE r.booking_id = $1::uuid AND r.cancelled_at IS NULL
       AND ($2::uuid[] IS NULL OR r.id = ANY($2::uuid[]))`,
    [bookingId, reservationIds],
  );
  const refundCents = preview.totalCents;
  return { refundCents, retainedCents: Number(paid?.paid_cents ?? 0) - refundCents };
}

export async function guestCancelRooms(bookingId: string, reservationIds: string[] | null): Promise<LifecycleResult> {
  const userId = await owner(bookingId);
  if (!userId) return { ok: false, error: 'not_found' };
  const result = await cancelRooms(
    {
      refund: refundPayment,
      isDefiniteFailure: isDefiniteRefundFailure,
      findRefund: findRefundForRow,
      onRefundProblem: ({ error, ...context }) =>
        Sentry.captureException(error, { tags: { area: 'refunds' }, extra: context }),
    },
    { bookingId, actor: { kind: 'guest', userId }, reservationIds },
  );
  if (result.ok && result.cancelled) await sendCancellation(bookingId, result.cancelled);
  revalidatePath(`/bookings/${bookingId}`);
  return result;
}
