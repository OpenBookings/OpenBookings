import { redirect } from 'next/navigation';

/** The booking page shows the confirmation, the policy and the cancel options. */
export default async function ConfirmationPage({ params }: { params: Promise<{ 'booking-ref': string }> }) {
  const { 'booking-ref': ref } = await params;
  redirect(`/bookings/${encodeURIComponent(ref)}`);
}
