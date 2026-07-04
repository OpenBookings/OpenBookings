import { createAccountLink } from '@openbookings/stripe';
import { auth } from '@/lib/auth';
import { queryOne } from '@openbookings/db';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = await queryOne<{ stripe_account_id: string | null }>(
    `SELECT step_data->>'stripe_account_id' AS stripe_account_id FROM host_onboarding WHERE user_id = $1`,
    [session.user.id]
  );
  if (!row?.stripe_account_id) return NextResponse.json({ error: 'No Stripe account' }, { status: 400 });

  const origin = new URL(req.url).origin;
  const url = await createAccountLink(row.stripe_account_id, {
    refreshUrl: `${origin}/onboarding/stripe-connect`,
    returnUrl: `${origin}/onboarding/verify`,
  });

  return NextResponse.json({ url });
}
