// packages/stripe/src/connect/sessions.ts

import { stripe } from '../client';

export async function createAccountSession(accountId: string) {
  const session = await stripe.accountSessions.create({
    account: accountId,
    components: {
      account_onboarding: { enabled: true },
    },
  });

  return session.client_secret;
}