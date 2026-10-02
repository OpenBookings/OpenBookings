import type Stripe from 'stripe';
import { stripe } from '../client';

export type ConnectHost = {
  email: string;
  legalCompanyName: string;
  /** ISO 3166-1 alpha-2, from the host's own address. */
  country: string;
};

/**
 * A connected account with its own full Stripe Dashboard.
 *
 * That choice fixes the rest of the controller: with a full dashboard Stripe
 * does not allow the platform to collect requirements, carry losses or pay the
 * processing fees. So Stripe owns KYC and authenticates the host itself (their
 * own login and 2FA, including for bank details), and the host pays Stripe's
 * fees and answers their own disputes.
 *
 * Nothing about the business is sent beyond a name to prefill: the host
 * confirms their legal details, business type and bank account in Stripe's
 * onboarding, which is the only place those are authoritative.
 *
 * The dashboard type cannot be changed on an existing account.
 */
export function buildConnectAccountParams(host: ConnectHost): Stripe.AccountCreateParams {
  const country = host.country.trim().toUpperCase();
  // No default. A wrong country creates an account under the wrong regulator
  // that then has to be thrown away.
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error(`Connected account needs a two-letter country code, got "${host.country}"`);
  }

  return {
    controller: {
      stripe_dashboard: { type: 'full' },
      requirement_collection: 'stripe',
      losses: { payments: 'stripe' },
      fees: { payer: 'account' },
    },
    country,
    email: host.email,
    capabilities: {
      // Direct charges are made on this account, so it needs to take cards.
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_profile: { name: host.legalCompanyName },
  };
}

export async function createConnectAccount(host: ConnectHost): Promise<string> {
  const account = await stripe.accounts.create(buildConnectAccountParams(host));
  return account.id; // persist this immediately
}
