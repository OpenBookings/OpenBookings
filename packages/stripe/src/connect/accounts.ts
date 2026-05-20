import { stripe } from '../client';

export async function createConnectAccount(hostData: {
  email: string;
  legalCompanyName: string;
  fullName: string;
  roleTitle: string;
  city: string;
  country: string;
  postalCode: string;
  streetAddress: string;
  cocNumber: string;
  vatNumber: string;
}) {
  const account = await stripe.accounts.create({
    controller: {
      stripe_dashboard: { type: 'none' },
      fees: { payer: 'application' },
      losses: { payments: 'application' },
      requirement_collection: 'application',
    },
    capabilities: {
      transfers: { requested: true },
    },
    country: 'NL',
    business_type: 'company',
    company: {
      name: hostData.legalCompanyName,
      address: {
        line1: hostData.streetAddress,
        city: hostData.city,
        postal_code: hostData.postalCode,
        country: 'NL',
      },
      registration_number: hostData.cocNumber,
      tax_id: hostData.vatNumber,
    },
  });

  return account.id; // persist this immediately
}