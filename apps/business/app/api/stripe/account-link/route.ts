import { createAccountLink, retrieveConnectAccount } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';
import { query, queryOne } from '@openbookings/db';
import { NextResponse } from 'next/server';
import { accountLinkDecision } from '@/lib/account-link-policy';

// The public address of this app. Not `new URL(req.url).origin`: behind the
// production proxy that is the address the container is bound to, and Stripe
// would send the host back to it.
const APP_URL = (process.env.NEXT_PUBLIC_BUSINESS_URL || 'https://business.openbookings.co').replace(/\/$/, '');

/**
 * Start or resume Stripe's own onboarding for the host's connected account.
 *
 * The link leads to Stripe, where the host signs in to their own Stripe
 * account. Bank details and identity are entered and later changed there,
 * behind Stripe's login, never through OpenBookings — which is why this needs
 * no step-up of its own.
 *
 * It is narrow on purpose: an owner only, and only while Stripe still needs
 * something. See accountLinkDecision.
 */
export async function POST() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = await queryOne<{
    stripe_account_id: string | null;
    onboarding_complete: boolean;
    is_owner: boolean;
  }>(
    // The connected account is the organisation's money. Before the
    // organisation exists (mid-onboarding) the person onboarding is its owner
    // to be; afterwards, only a member with the owner role.
    `SELECT ho.step_data->>'stripe_account_id' AS stripe_account_id,
            (ho.onboarding_completed_at IS NOT NULL) AS onboarding_complete,
            (NOT EXISTS (SELECT 1 FROM "member" m WHERE m."userId" = $1)
              OR EXISTS (SELECT 1 FROM "member" m WHERE m."userId" = $1 AND m.role = 'owner')) AS is_owner
     FROM host_onboarding ho
     WHERE ho.user_id = $1`,
    [session.user.id]
  );

  let requirementsDue = 0;
  if (row?.stripe_account_id && row.onboarding_complete && row.is_owner) {
    // Only asked when it decides the answer. Unreachable Stripe means no link.
    try {
      const account = await retrieveConnectAccount(row.stripe_account_id);
      requirementsDue = account.requirements?.currently_due?.length ?? 0;
    } catch {
      return NextResponse.json({ error: 'Stripe is unavailable' }, { status: 503 });
    }
  }

  const decision = accountLinkDecision({
    isOwner: row?.is_owner === true,
    stripeAccountId: row?.stripe_account_id ?? null,
    onboardingComplete: row?.onboarding_complete === true,
    requirementsDue,
  });

  if (decision === 'forbidden') {
    return NextResponse.json({ error: 'Only an owner can do this' }, { status: 403 });
  }
  if (decision === 'no-account') {
    return NextResponse.json({ error: 'No Stripe account' }, { status: 400 });
  }
  if (decision === 'complete') {
    return NextResponse.json(
      { error: 'Your Stripe account is set up. Manage it in your Stripe Dashboard.' },
      { status: 409 }
    );
  }

  const stage = row!.onboarding_complete ? 'stripe-requirements' : 'onboarding';
  const url = await createAccountLink(row!.stripe_account_id!, {
    refreshUrl: `${APP_URL}/onboarding/stripe`,
    returnUrl: row!.onboarding_complete ? `${APP_URL}/dashboard/finance` : `${APP_URL}/onboarding/stripe`,
  });

  await query(
    `INSERT INTO audit_log (action, actor_user_id, detail)
     VALUES ('payout.onboarding-link-created', $1, $2)`,
    [session.user.id, JSON.stringify({ stage })]
  ).catch((error) => {
    // The link is already minted; failing the request would only hide it.
    console.error('[account-link] audit write failed:', error instanceof Error ? error.message : error);
  });

  return NextResponse.json({ url });
}
