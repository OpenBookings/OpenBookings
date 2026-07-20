export const ONBOARDING_STEPS = ["core-info", "address", "legal", "stripe"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const STEP_TITLES: Record<OnboardingStep, string> = {
  "core-info": "Tell us about your property",
  address: "Where is your property located?",
  legal: "Legal & agreements",
  stripe: "Set up Stripe",
};

export const STEP_SUBTITLES: Record<OnboardingStep, string> = {
  "core-info": "This is what guests will see on OpenBookings.",
  address: "We use this to show your property on the map.",
  legal: "We need a few details before you can start accepting bookings.",
  stripe: "Connect your Stripe account to receive payouts.",
};
