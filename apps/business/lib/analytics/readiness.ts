export type ReadinessState = "done" | "todo" | "unknown";

export interface ReadinessItem {
  key: string;
  label: string;
  state: ReadinessState;
  /** Where the host fixes it. */
  href: string;
  /** The link's text. */
  action: string;
}

export interface ReadinessFacts {
  listingLive: boolean;
  availabilityOpen: boolean;
  hasActiveRatePlan: boolean;
  /** Null when the payment provider could not be asked. */
  paymentsConnected: boolean | null;
}

export const NOT_STARTED: ReadinessFacts = {
  listingLive: false,
  availabilityOpen: false,
  hasActiveRatePlan: false,
  paymentsConnected: false,
};

const state = (done: boolean | null): ReadinessState =>
  done === null ? "unknown" : done ? "done" : "todo";

/** Everything a host with no bookings can fix today, in the order they would. */
export function evaluateReadiness(facts: ReadinessFacts): ReadinessItem[] {
  return [
    {
      key: "listing",
      label: "Listing is live",
      state: state(facts.listingLive),
      href: "/dashboard/listings/property",
      action: "Publish listing",
    },
    {
      key: "availability",
      label: "Availability is open for the next 90 days",
      state: state(facts.availabilityOpen),
      href: "/dashboard/listings/rates-availability",
      action: "Open dates",
    },
    {
      key: "rate-plan",
      label: "At least one active rate plan",
      state: state(facts.hasActiveRatePlan),
      href: "/dashboard/listings/rates-availability",
      action: "Add a rate plan",
    },
    {
      key: "payments",
      label: "Payments connected",
      state: state(facts.paymentsConnected),
      href: "/onboarding/stripe",
      action: "Connect payments",
    },
  ];
}

export const isReady = (items: ReadinessItem[]): boolean => items.every((item) => item.state === "done");
