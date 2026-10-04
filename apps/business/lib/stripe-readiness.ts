/**
 * Whether a host's connected account is ready for bookings. Shared by the
 * verify step (in the browser) and completeOnboarding() (on the server, where
 * it is enforced), so no server-only imports here.
 */
export type StripeAccountSummary = {
  accountId: string;
  currentlyDue: string[];
  eventuallyDue: string[];
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export function isStripeAccountReady(account: StripeAccountSummary): boolean {
  // Both: a host who can take payments but cannot be paid out is not ready.
  return account.currentlyDue.length === 0 && account.chargesEnabled && account.payoutsEnabled;
}
