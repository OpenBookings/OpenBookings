import { stripe } from '../client';

export type PaymentMethodDomainResult = {
  outcome: 'exists' | 'created' | 'enabled';
  /** Apple Pay's verdict on the domain ("active", "inactive"), when Stripe gives one. */
  applePay: string | null;
};

/**
 * Makes sure `domain` is registered on a hotel's connected account.
 *
 * Bookings are direct charges, so the hotel is the merchant, and Stripe only
 * shows Apple Pay (and recommends it for Google Pay and Link) on a domain
 * registered for the account that takes the payment. Registering on the
 * platform's own account does nothing for them.
 *
 * Idempotent: an enabled registration is left alone, a disabled one is turned
 * back on. Stripe's errors are the caller's to handle.
 */
export async function ensurePaymentMethodDomain(
  stripeAccountId: string,
  domain: string,
): Promise<PaymentMethodDomainResult> {
  const options = { stripeAccount: stripeAccountId };
  const { data } = await stripe.paymentMethodDomains.list({ domain_name: domain, limit: 1 }, options);
  const existing = data[0];

  if (existing?.enabled) {
    return { outcome: 'exists', applePay: existing.apple_pay?.status ?? null };
  }
  if (existing) {
    const enabled = await stripe.paymentMethodDomains.update(existing.id, { enabled: true }, options);
    return { outcome: 'enabled', applePay: enabled.apple_pay?.status ?? null };
  }
  const created = await stripe.paymentMethodDomains.create({ domain_name: domain }, options);
  return { outcome: 'created', applePay: created.apple_pay?.status ?? null };
}
