import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { CheckoutClient } from './_components/CheckoutClient';
import type { GateViewer } from './_components/CheckoutGate';
import {
  formatDayNumber,
  formatGuests,
  formatNights,
  formatShortDate,
  formatWeekdayMonth,
  getBookingSummary,
} from './_lib/booking';

export const metadata: Metadata = {
  title: 'Complete your booking',
};

/** The booking is read per request; a cached page would show a lapsed hold. */
export const dynamic = 'force-dynamic';

/**
 * Who is checking out, or null if nobody is signed in.
 *
 * Read here rather than in the browser so the gate knows on its first paint
 * whether it owes a sign-in step — a client-side session fetch would show the
 * sign-in form for a frame to guests who are already signed in, which is the
 * one audience that must never see it.
 *
 * This is not the access check. The gate is UI and UI can be bypassed; the
 * real refusal lives in `POST /api/checkout`, which reads the session itself
 * and will not create a Session without one.
 */
async function getViewer(): Promise<GateViewer | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.email) return null;
    return { email: session.user.email, name: session.user.name ?? null };
  } catch {
    // A session that cannot be read is a session we do not have. The gate
    // asks for sign-in, which is the right outcome either way.
    return null;
  }
}

export default async function CheckoutPage() {
  const [summary, viewer] = await Promise.all([getBookingSummary(), getViewer()]);

  // Dates are formatted here so the client component stays free of Date props,
  // and so they resolve in one place rather than in each of the four spots the
  // summary shows one.
  //
  // The price breakdown is deliberately absent: the client reads it from the
  // Checkout Session instead, so it cannot disagree with what Stripe charges.
  return (
    <CheckoutClient
      viewer={viewer}
      heroImageUrl={summary.heroImageUrl}
      logoUrl={summary.logoUrl}
      propertyName={summary.propertyName}
      locationLabel={summary.locationLabel}
      roomName={summary.roomName}
      roomType={summary.roomType}
      bedType={summary.bedType}
      sizeSqm={summary.sizeSqm}
      roomImageUrl={summary.roomImageUrl}
      checkInDay={formatDayNumber(summary.checkIn)}
      checkInMonth={formatWeekdayMonth(summary.checkIn)}
      checkOutDay={formatDayNumber(summary.checkOut)}
      checkOutMonth={formatWeekdayMonth(summary.checkOut)}
      checkInTime={summary.checkInTime}
      checkOutTime={summary.checkOutTime}
      nightsLabel={formatNights(summary.nights)}
      guestsLabel={formatGuests(summary.adults, summary.children)}
      cancellationPolicy={summary.cancellationPolicy}
      freeCancellationLabel={
        summary.freeCancellationUntil ? formatShortDate(summary.freeCancellationUntil) : null
      }
    />
  );
}
