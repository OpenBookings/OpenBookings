import { stripe } from '../client';

export async function retrieveConnectAccount(accountId: string) {
  return stripe.accounts.retrieve(accountId);
}
