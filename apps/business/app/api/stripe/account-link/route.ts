import { createAccountLink } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';
import { queryOne } from '@openbookings/db';
import { NextResponse } from 'next/server';
<<<<<<< Updated upstream
=======
import { accountLinkDecision, accountLinkSubject } from '@/lib/account-link-policy';
import { getOnboardingFacts, wizardInProgress } from '@/lib/onboarding-facts';
>>>>>>> Stashed changes

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

<<<<<<< Updated upstream
  const row = await queryOne<{ stripe_account_id: string | null }>(
    `SELECT step_data->>'stripe_account_id' AS stripe_account_id FROM host_onboarding WHERE user_id = $1`,
    [session.user.id]
  );
  if (!row?.stripe_account_id) return NextResponse.json({ error: 'No Stripe account' }, { status: 400 });

  const origin = new URL(req.url).origin;
  const url = await createAccountLink(row.stripe_account_id, {
    refreshUrl: `${origin}/onboarding/stripe`,
    returnUrl: `${origin}/onboarding/stripe`,
=======
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
>>>>>>> Stashed changes
  });

  return NextResponse.json({ url });
}
