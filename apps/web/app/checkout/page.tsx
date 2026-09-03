import type { Metadata } from 'next';
import { CheckoutClient } from './_components/CheckoutClient';
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

export default async function CheckoutPage() {
  const summary = await getBookingSummary();

  // Dates are formatted here so the client component stays free of Date props,
  // and so they resolve in one place rather than in each of the four spots the
  // summary shows one.
  //
  // The price breakdown is deliberately absent: the client reads it from the
  // Checkout Session instead, so it cannot disagree with what Stripe charges.
  return (
    <CheckoutClient
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
