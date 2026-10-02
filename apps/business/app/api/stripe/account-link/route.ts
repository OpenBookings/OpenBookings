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

  // Two ways to be entitled to this account's onboarding link:
  //
  // - Mid-onboarding there is no organisation yet. The person onboarding is
  //   its owner-to-be, whatever their role in some other organisation.
  // - Afterwards, only an owner of the organisation the account belongs to.
  //   Not "whoever has an onboarding row": a removed or demoted ex-owner still
  //   has one, and a second owner never did.
  const onboarding = await queryOne<{ stripe_account_id: string | null; complete: boolean }>(
    `SELECT step_data->>'stripe_account_id' AS stripe_account_id,
            (onboarding_completed_at IS NOT NULL) AS complete
     FROM host_onboarding WHERE user_id = $1`,
    [session.user.id]
  );

  let stripeAccountId: string | null;
  let isOwner: boolean;
  let onboardingComplete: boolean;

  if (onboarding && !onboarding.complete) {
    stripeAccountId = onboarding.stripe_account_id;
    isOwner = true;
    onboardingComplete = false;
  } else {
    const owned = await queryOne<{ stripe_account_id: string }>(
      `SELECT op.stripe_account_id
       FROM "member" m
       JOIN org_profile op ON op.organization_id = m."organizationId"
       WHERE m."userId" = $1 AND m.role = 'owner' AND op.stripe_account_id IS NOT NULL
       ORDER BY (op.stripe_account_id = $2) DESC, m."createdAt"
       LIMIT 1`,
      [session.user.id, onboarding?.stripe_account_id ?? null]
    );
    stripeAccountId = owned?.stripe_account_id ?? null;
    // No owned organisation with an account. If the user has nothing at all
    // there is simply no account; if they onboarded once but own nothing now,
    // they are no longer entitled to it.
    isOwner = owned !== null || !onboarding;
    onboardingComplete = true;
  }

  let requirementsDue = 0;
  if (isOwner && stripeAccountId && onboardingComplete) {
    // Only asked when it decides the answer. Unreachable Stripe means no link.
    try {
      const account = await retrieveConnectAccount(stripeAccountId);
      requirementsDue = account.requirements?.currently_due?.length ?? 0;
    } catch {
      return NextResponse.json({ error: 'Stripe is unavailable' }, { status: 503 });
    }
  }

  const decision = accountLinkDecision({ isOwner, stripeAccountId, onboardingComplete, requirementsDue });

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

  const stage = onboardingComplete ? 'stripe-requirements' : 'onboarding';
  const url = await createAccountLink(stripeAccountId!, {
    refreshUrl: onboardingComplete ? `${APP_URL}/dashboard/finance` : `${APP_URL}/onboarding/stripe`,
    returnUrl: onboardingComplete ? `${APP_URL}/dashboard/finance` : `${APP_URL}/onboarding/stripe`,
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
