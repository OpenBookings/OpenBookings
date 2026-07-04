import { stripe } from '../client';

export async function createAccountLink(accountId: string, urls: { refreshUrl: string; returnUrl: string }) {
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: urls.refreshUrl,
    return_url: urls.returnUrl,
    type: 'account_onboarding',
  });

  return accountLink.url;
}
