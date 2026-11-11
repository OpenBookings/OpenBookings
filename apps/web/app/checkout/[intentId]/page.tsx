import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { readGuestProfile } from '@/lib/account/guest-details';
import { COUNTRIES, DIAL_CODES } from '@/lib/account/countries';
import { prefillFromProfile } from '../_lib/guest-details';
import type { BookingIntentStatus } from '@openbookings/db';
import { CheckoutClient, CheckoutSignIn, type CheckoutClientProps } from '../_components/CheckoutClient';
import type { GateViewer } from '../_components/CheckoutGate';
import type { TripSummaryCancellation } from '../_components/TripSummary';
import {
  BookingNotFoundError,
  formatDayNumber,
  formatNights,
  formatWeekdayMonth,
  getBookingSummary,
  type StayRoom,
} from '../_lib/booking';
import { payAtPropertyNote } from '../_lib/party';

export const metadata: Metadata = {
  title: 'Complete your booking',
};

/** The intent is read per request; a cached page would show a lapsed hold. */
export const dynamic = 'force-dynamic';

/**
 * Who is checking out, or null if nobody is signed in.
 *
 * Read here rather than in the browser so the gate knows on its first paint
 * whether it owes a sign-in step — a client-side session fetch would show the
 * sign-in form for a frame to guests who are already signed in, which is the
 * one audience that must never see it.
 *
 * This is not the access check for paying. The gate is UI and UI can be
 * bypassed; the real refusal lives in `POST /api/checkout`, which reads the
 * session itself and will not create a Session without one.
 */
async function getViewer(): Promise<(GateViewer & { id: string }) | null> {
  try {
    const session = await getServerSession();
    if (!session?.user?.email || !session.user.id) return null;
    return { id: session.user.id, email: session.user.email, name: session.user.name ?? null };
  } catch {
    // A session that cannot be read is a session we do not have. The gate
    // asks for sign-in, which is the right outcome either way.
    return null;
  }
}

/** Rooms on the same terms share one cancellation panel, in the order the rooms come. */
function groupCancellations(rooms: StayRoom[]): TripSummaryCancellation[] {
  const groups = new Map<string, TripSummaryCancellation>();
  for (const room of rooms) {
    const { tierLabel, steps } = room.cancellation;
    const key = JSON.stringify([tierLabel, steps]);
    const group = groups.get(key) ?? { steps, roomNames: [] };
    if (!group.roomNames.includes(room.roomName)) group.roomNames.push(room.roomName);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** What the page shows for the intent's status. Paid and oversold intents were charged; no other was. */
function intentStatus(status: BookingIntentStatus): CheckoutClientProps['intentStatus'] {
  if (status === 'open' || status === 'paid') return status;
  if (status === 'oversold' || status === 'refunded_oversold') return 'oversold';
  return 'expired';
}

export default async function CheckoutPage({ params }: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await params;
  const viewer = await getViewer();

  // The intent is the guest's own: until we know who they are there is
  // nothing of it to show, only the sign-in step that comes back here.
  if (!viewer) return <CheckoutSignIn intentId={intentId} />;

  let summary;
  try {
    summary = await getBookingSummary({ intentId, userId: viewer.id });
  } catch (err) {
    // Someone else's intent, or no such intent: the same answer for both.
    if (err instanceof BookingNotFoundError) notFound();
    throw err;
  }

  // The details card starts from the account. Read here, beside the intent,
  // so the card is filled on first paint.
  const profile = await readGuestProfile(viewer.id);
  const guestDetails = prefillFromProfile({
    name: viewer.name ?? '',
    email: viewer.email,
    phone: profile.phone,
    address: profile.address,
  });

  // Dates are formatted here so the client component stays free of Date props,
  // and so they resolve in one place rather than in each of the four spots the
  // summary shows one.
  //
  // The price breakdown is deliberately absent: the client reads it from the
  // Checkout Session instead, so it cannot disagree with what Stripe charges.
  return (
    <CheckoutClient
      viewer={{ email: viewer.email, name: viewer.name }}
      guestDetails={guestDetails}
      countries={COUNTRIES}
      dialCodes={DIAL_CODES}
      stripeAccountId={summary.stripeAccountId}
      intentId={summary.intentId}
      holdExpiresAt={summary.holdExpiresAt.getTime()}
      // An open intent whose hold has run out is ended by the page's
      // countdown, which finds it already at zero.
      intentStatus={intentStatus(summary.status)}
      backHref={`/p/${summary.propertySlug}`}
      heroImageUrl={summary.heroImageUrl}
      logoUrl={summary.logoUrl}
      propertyName={summary.propertyName}
      locationLabel={summary.locationLabel}
      rooms={summary.rooms.map((room) => ({
        id: room.intentRoomId,
        roomName: room.roomName,
        roomType: room.roomType,
        bedType: room.bedType,
        sizeSqm: room.sizeSqm,
        roomImageUrl: room.roomImageUrl,
        ratePlanName: room.ratePlanName,
        adults: room.adults,
        children: room.children,
        infants: room.infants,
        includesBreakfast: room.includesBreakfast,
        cots: room.cots,
        extraBeds: room.extraBeds,
      }))}
      ledgerRooms={summary.rooms.map((room) => ({
        roomName: room.roomName,
        rateNights: room.rateNights,
        extraGuests: room.extraGuests,
        discount: room.discount,
        touristTaxLines: room.touristTaxLines,
        payAtPropertyLines: room.payAtPropertyLines,
      }))}
      checkInDay={formatDayNumber(summary.checkIn)}
      checkInMonth={formatWeekdayMonth(summary.checkIn)}
      checkOutDay={formatDayNumber(summary.checkOut)}
      checkOutMonth={formatWeekdayMonth(summary.checkOut)}
      checkInTime={summary.checkInTime}
      checkOutTime={summary.checkOutTime}
      nightsLabel={formatNights(summary.nights)}
      cancellations={groupCancellations(summary.rooms)}
      payAtPropertyNote={payAtPropertyNote(summary.rooms)}
      requiresNonRefundableConsent={summary.rooms.some((room) => room.cancellation.requiresNonRefundableConsent)}
    />
  );
}
