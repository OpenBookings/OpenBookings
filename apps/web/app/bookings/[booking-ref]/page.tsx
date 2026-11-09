import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { CircleCheck, CircleX, Star } from 'lucide-react';
import { getPool } from '@openbookings/db';
import { getReviewContext } from '@openbookings/db/reviews';
import { BACKDROP_COOKIE } from '@openbookings/images';
import { getBackdrop } from '@openbookings/images/server';
import { getServerSession } from '@/lib/auth';
import { AuthFormFields, AuthFormPhaseProvider } from '@/components/auth/AuthFormFields';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { Nav } from '@/components/nav';
import { cn } from '@/lib/utils';
import { BookingTimeline } from './_components/BookingTimeline';
import { CancelDialog } from './_components/CancelDialog';
import { EditRoomsButton, EditRoomsProvider, WhenEditing } from './_components/edit-rooms';
import { MessagePropertyButton } from './_components/MessagePropertyButton';
import { loadGuestBooking } from './_lib/load';

export const metadata: Metadata = { title: 'Your booking' };
export const dynamic = 'force-dynamic';

const euros = new Intl.NumberFormat('en-NL', {
  style: 'currency',
  currency: 'EUR',
});
const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const fmtDay = (iso: string) => day.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/** The reassurance line above the property name. */
const STATUS: Record<string, { label: string; ok: boolean }> = {
  confirmed: { label: 'Booking confirmed', ok: true },
  checked_in: { label: "You're checked in", ok: true },
  completed: { label: 'Stay completed', ok: true },
  cancelled: { label: 'Booking cancelled', ok: false },
  no_show: { label: 'Marked as a no-show', ok: false },
};

/** The logo's spectrum as a hairline of light, fading out at both ends (DESIGN_SYSTEM.md §3.5). */
const SPECTRUM_HAIRLINE =
  'linear-gradient(to right, transparent, var(--spectrum-coral) 15%, var(--spectrum-amber), var(--spectrum-lemon), var(--spectrum-mint), var(--spectrum-sky), var(--spectrum-lilac) 85%, transparent)';

export default async function BookingPage({ params }: { params: Promise<{ 'booking-ref': string }> }) {
  const { 'booking-ref': bookingId } = await params;
  const [session, { backdrop }] = await Promise.all([
    getServerSession(),
    cookies().then((c) => getBackdrop(c.get(BACKDROP_COOKIE)?.value)),
  ]);

  if (!session) {
    return (
      <div className="relative min-h-dvh font-sans text-white">
        <GlassBackdrop backdrop={backdrop} />
        <Nav />
        <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center gap-6 px-4">
          <h1 className="text-center font-serif text-3xl">Sign in to see your booking</h1>
          <div className="w-full max-w-sm">
            <AuthFormPhaseProvider>
              <AuthFormFields callbackURL={`/bookings/${encodeURIComponent(bookingId)}`} />
            </AuthFormPhaseProvider>
          </div>
        </main>
      </div>
    );
  }

  const [booking, review] = await Promise.all([
    loadGuestBooking(bookingId, session.user.id),
    getReviewContext(getPool(), bookingId, new Date()),
  ]);
  if (!booking) notFound();
  const ownReview = review?.guestUserId === session.user.id ? review : null;
  const reviewLink =
    ownReview?.review && ownReview.review.status !== 'deleted'
      ? 'Your review'
      : ownReview?.eligibility.ok
        ? 'Write a review'
        : null;

  const { trip } = booking.timeline;
  const activeRooms = booking.rooms.filter((r) => !r.cancelledAt);
  const status = STATUS[booking.status] ?? { label: booking.status, ok: true };
  const live = trip.countdown !== null;
  // Cancelling one room only makes sense with more than one left.
  const canCancelRooms = booking.canCancel && activeRooms.length > 1;

  return (
    <div className="relative min-h-dvh font-sans text-white">
      <GlassBackdrop backdrop={backdrop} />
      <Nav />

      <EditRoomsProvider>
        <main className="relative z-10 mx-auto grid max-w-5xl items-start gap-x-14 gap-y-10 px-4 pt-24 pb-20 sm:px-6 sm:pt-28 md:pt-36 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Who and where. The card on the right starts level with the ticket, below this. */}
          <header className="min-w-0">
            <p className="flex items-center gap-2 text-sm text-white/70">
              {status.ok ? (
                <CircleCheck aria-hidden className="size-4" style={{ color: 'var(--spectrum-mint)' }} />
              ) : (
                <CircleX aria-hidden className="size-4 text-white/50" />
              )}
              {status.label}
              <span aria-hidden className="text-white/30">
                ·
              </span>
              <span className="text-white/45 tabular-nums">{booking.reference}</span>
            </p>
            <h1 className="mt-3 font-serif text-5xl leading-[1.05] sm:text-6xl">{booking.propertyName}</h1>
            {booking.city ? <p className="mt-2 text-lg text-white/65">{booking.city}</p> : null}
          </header>

          {/* The stay: what the guest booked, front and centre. */}
          <article className="flex min-w-0 flex-col lg:col-start-1 lg:row-start-2">
            {/* Ticket: check-in ↔ check-out. */}
            <section
              aria-label="Your stay"
              className={cn(
                'relative overflow-hidden rounded-2xl border border-white/15 bg-black/35 shadow-2xl backdrop-blur-md',
                !live && 'opacity-80',
              )}
            >
              {live ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px opacity-80"
                  style={{ background: SPECTRUM_HAIRLINE }}
                />
              ) : null}
              {trip.countdown ? (
                <p className="px-6 pt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60 sm:px-8 sm:pt-6">
                  {trip.countdown}
                  {/* No room for the nights pill between the dates on a phone. */}
                  <span className="sm:hidden">
                    {' · '}
                    {trip.nights} {trip.nights === 1 ? 'night' : 'nights'}
                  </span>
                </p>
              ) : null}
              <div
                className={cn(
                  'grid grid-cols-2 items-start gap-4 sm:grid-cols-[1fr_auto_1fr] px-6 pb-6 sm:px-8 sm:pb-7',
                  trip.countdown ? 'pt-3' : 'pt-6',
                )}
              >
                <div>
                  <p className="text-xs text-white/50">Check-in</p>
                  <p className="mt-1 font-serif text-2xl leading-tight sm:text-[32px]">{trip.checkInDate}</p>
                  <p className="mt-1 text-sm text-white/60">from {trip.checkInTime}</p>
                </div>
                <div className="hidden h-full items-center sm:flex">
                  <span className="rounded-full border border-white/15 px-3 py-1 text-xs whitespace-nowrap text-white/75">
                    {trip.nights} {trip.nights === 1 ? 'night' : 'nights'}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xs text-white/50">Check-out</p>
                  <p className="mt-1 font-serif text-2xl leading-tight sm:text-[32px]">{trip.checkOutDate}</p>
                  <p className="mt-1 text-sm text-white/60">until {trip.checkOutTime}</p>
                </div>
              </div>
            </section>

            {/* Rooms: quiet, it's the detail. */}
            <section aria-labelledby="rooms" className="mt-8">
              <h2 id="rooms" className="text-xs text-white/50">
                {booking.rooms.length === 1 ? 'Your room' : `${booking.rooms.length} rooms`}
              </h2>
              <ul className="mt-2 divide-y divide-white/10 border-y border-white/10">
                {booking.rooms.map((room) => (
                  <li
                    key={room.reservationId}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className={cn('text-[15px]', room.cancelledAt ? 'text-white/45 line-through' : 'text-white')}>
                        {room.roomName}
                      </p>
                      <p className="text-[13px] text-white/45">
                        {room.cancelledAt ? `Cancelled ${fmtDay(room.cancelledAt)}` : `${room.tierLabel} rate`}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      {!room.cancelledAt && canCancelRooms ? (
                        <WhenEditing>
                          <CancelDialog
                            bookingId={booking.id}
                            reservationIds={[room.reservationId]}
                            label="this room"
                            hint={room.cancelHint}
                            small
                          />
                        </WhenEditing>
                      ) : null}
                      <span className="text-sm text-white/60 tabular-nums">{euros.format(room.paid)}</span>
                    </div>
                  </li>
                ))}
              </ul>

              {/* What was paid, under the rooms it paid for. */}
              <dl className="mt-3 flex flex-col gap-1 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-white/55">Paid</dt>
                  <dd className="font-medium tabular-nums">{euros.format(booking.totalPaid)}</dd>
                </div>
                {booking.refunded > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-white/55">Refunded · back on your card within 5–10 days</dt>
                    <dd className="tabular-nums">{euros.format(booking.refunded)}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </article>

          {/* Right now, and what the guest can do about it. */}
          <aside
            aria-label="Status and actions"
            className="flex flex-col gap-6 rounded-2xl border border-white/15 bg-black/45 p-6 shadow-2xl backdrop-blur-md lg:sticky lg:top-36 lg:col-start-2 lg:row-start-2"
          >
            <BookingTimeline timeline={booking.timeline} />

            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-5">
              <MessagePropertyButton bookingId={booking.id} />
              {reviewLink ? (
                <Link
                  href={`/bookings/${booking.id}/review`}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 text-sm text-white backdrop-blur-sm hover:bg-white/15"
                >
                  <Star aria-hidden className="size-4" />
                  {reviewLink}
                </Link>
              ) : null}
              {canCancelRooms ? <EditRoomsButton /> : null}
              {booking.canCancel && activeRooms.length > 0 ? (
                <CancelDialog
                  bookingId={booking.id}
                  reservationIds={null}
                  label={activeRooms.length > 1 ? 'whole booking' : 'booking'}
                  hint={booking.cancelHint}
                />
              ) : null}
            </div>
          </aside>
        </main>
      </EditRoomsProvider>
    </div>
  );
}
