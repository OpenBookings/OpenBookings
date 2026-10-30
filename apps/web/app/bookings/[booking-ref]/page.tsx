import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { AuthFormFields, AuthFormPhaseProvider } from '@/components/auth/AuthFormFields';
import { CancelDialog } from './_components/CancelDialog';
import { loadGuestBooking } from './_lib/load';

export const metadata: Metadata = { title: 'Your booking' };
export const dynamic = 'force-dynamic';

const euros = new Intl.NumberFormat('en-NL', { style: 'currency', currency: 'EUR' });
const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDay = (iso: string) => day.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

const STATUS: Record<string, string> = {
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Stay completed',
  cancelled: 'Cancelled',
  no_show: 'Marked as a no-show',
};

export default async function BookingPage({ params }: { params: Promise<{ 'booking-ref': string }> }) {
  const { 'booking-ref': bookingId } = await params;
  const session = await getServerSession();

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#0a0a0a] px-4 text-white">
        <h1 className="font-serif text-3xl">Sign in to see your booking</h1>
        <AuthFormPhaseProvider>
          <AuthFormFields callbackURL={`/bookings/${encodeURIComponent(bookingId)}`} />
        </AuthFormPhaseProvider>
      </main>
    );
  }

  const booking = await loadGuestBooking(bookingId, session.user.id);
  if (!booking) notFound();

  const activeRooms = booking.rooms.filter((r) => !r.cancelledAt);

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-12 text-white">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
            Booking {booking.reference} · {STATUS[booking.status] ?? booking.status}
          </p>
          <h1 className="font-serif text-4xl">{booking.propertyName}</h1>
          <p className="text-white/70">
            {booking.city ? `${booking.city} · ` : ''}
            {fmtDay(booking.checkInDate)} – {fmtDay(booking.checkOutDate)}
          </p>
        </header>

        <section className="flex flex-col gap-4">
          {booking.rooms.map((room) => (
            <article key={room.reservationId} className="rounded-2xl border border-white/12 bg-white/5 p-5">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className={room.cancelledAt ? 'text-white/50 line-through' : 'font-medium'}>{room.roomName}</h2>
                <span className="text-sm text-white/60">{euros.format(room.paid)}</span>
              </div>
              {room.cancelledAt ? (
                <p className="mt-2 text-sm text-white/60">Cancelled on {fmtDay(room.cancelledAt)}</p>
              ) : (
                <>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
                    Cancellation · {room.tierLabel}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-white/75">
                    {room.policyLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {booking.canCancel && activeRooms.length > 1 && (
                    <div className="mt-4">
                      <CancelDialog bookingId={booking.id} reservationIds={[room.reservationId]} label="this room" />
                    </div>
                  )}
                </>
              )}
            </article>
          ))}
        </section>

        {booking.refunded > 0 && (
          <p className="text-sm text-white/75">
            {euros.format(booking.refunded)} refunded to your card. It can take 5–10 days to show.
          </p>
        )}

        {booking.canCancel && activeRooms.length > 0 && (
          <CancelDialog bookingId={booking.id} reservationIds={null} label="booking" />
        )}
      </div>
    </main>
  );
}
