import { createAccountLink } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';
import { queryOne } from '@openbookings/db';
import { NextResponse } from 'next/server';

// The public address of this app. Not `new URL(req.url).origin`: behind the
// production proxy that is the address the container is bound to, and Stripe
// would send the host back to it.
const APP_URL = (process.env.NEXT_PUBLIC_BUSINESS_URL || 'https://business.openbookings.co').replace(/\/$/, '');

/**
 * Start or resume Stripe's own onboarding for the host's connected account.
 *
 * The link leads to Stripe, where the host signs in to their own Stripe
 * account. Bank details and identity are entered and later changed there,
 * behind Stripe's login, never through OpenBookings.
 */
export async function POST() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = await queryOne<{ stripe_account_id: string | null }>(
    `SELECT step_data->>'stripe_account_id' AS stripe_account_id FROM host_onboarding WHERE user_id = $1`,
    [session.user.id]
  );
  if (!row?.stripe_account_id) return NextResponse.json({ error: 'No Stripe account' }, { status: 400 });

  const url = await createAccountLink(row.stripe_account_id, {
    refreshUrl: `${APP_URL}/onboarding/stripe`,
    returnUrl: `${APP_URL}/onboarding/stripe`,
  });

  return NextResponse.json({ url });
}
