import {
  buildPolicySnapshot,
  describePolicy,
  describePolicySteps,
  snapshotTier,
  TIER_LABELS,
  type CancellationTier,
  type PolicyStep,
  type PropertyCancellationTier,
} from '@openbookings/pricing';

export type CheckoutCancellationTerms = {
  cancellationTier: CancellationTier;
  tierLabel: string;
  /** The policy as sentences, deadlines as exact local dates (Annex B B.5.9). */
  policyLines: string[];
  /** The same policy as a timeline, for the checkout schedule. */
  steps: PolicyStep[];
  /** Annex B B.4.3: a Non-refundable rate is chosen explicitly before paying. */
  requiresNonRefundableConsent: boolean;
};

/**
 * What checkout tells the guest about cancelling, worked out as if they book
 * right now. The booking stores its own snapshot once paid; this is the same
 * calculation, so what they read is what they get.
 */
export function checkoutCancellationTerms(i: {
  propertyTier: PropertyCancellationTier;
  isRefundable: boolean;
  timeZone: string;
  checkInTime: string | null;
  arrivalDate: string;
  now: Date;
}): CheckoutCancellationTerms {
  const tier = snapshotTier(i.propertyTier, i.isRefundable);
  const snapshot = buildPolicySnapshot({
    tier,
    timeZone: i.timeZone,
    checkInTime: i.checkInTime,
    arrivalDate: i.arrivalDate,
    confirmedAt: i.now,
  });
  return {
    cancellationTier: tier,
    tierLabel: TIER_LABELS[tier],
    policyLines: describePolicy(snapshot, i.timeZone, i.now),
    steps: describePolicySteps(snapshot, i.timeZone, i.now),
    requiresNonRefundableConsent: tier === 'non_refundable',
  };
}
