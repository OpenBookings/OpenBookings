import { createAccountLink, retrieveConnectAccount } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';
import { query, queryOne } from '@openbookings/db';
import { NextResponse } from 'next/server';
import { accountLinkDecision, accountLinkSubject } from '@/lib/account-link-policy';
import { getOnboardingFacts, wizardInProgress } from '@/lib/onboarding-facts';

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

  // Mid-wizard, the person onboarding is the owner-to-be of the wizard's
  // account; afterwards, only an owner of an organisation that holds one. A
  // removed ex-owner still has a wizard row, but it is no longer in progress,
  // so they fall through to the ownership check. See accountLinkSubject.
  const facts = await getOnboardingFacts(session.user.id);
  const inProgress = wizardInProgress(facts);
  const owned = inProgress
    ? null
    : await queryOne<{ stripe_account_id: string }>(
        `SELECT op.stripe_account_id
         FROM "member" m
         JOIN org_profile op ON op.organization_id = m."organizationId"
         WHERE m."userId" = $1 AND m.role = 'owner' AND op.stripe_account_id IS NOT NULL
         ORDER BY (op.stripe_account_id = $2) DESC, m."createdAt"
         LIMIT 1`,
        [session.user.id, facts.wizard?.stripeAccountId ?? null]
      );

  const { stripeAccountId, isOwner, onboardingComplete } = accountLinkSubject({
    wizard: facts.wizard && { stripeAccountId: facts.wizard.stripeAccountId, inProgress },
    ownedStripeAccountId: owned?.stripe_account_id ?? null,
  });

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
