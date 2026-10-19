/**
 * Ticket categories for host support. Product copy, shared by the intake
 * (browser) and ticket creation (server, which validates against it).
 *
 * The list is the handoff's proposal and still an open question; changing it
 * here changes the intake, titles and the Chatwoot `category` attribute.
 * Existing tickets keep the id they were created with, so remove an id only
 * together with a fallback in `categoryLabel`.
 */

export type LinkedKind = "booking" | "listing";

export type SupportCategory = {
  id: string;
  label: string;
  /** One line under the label on the category cards. */
  blurb: string;
  /** Quiet callout on the message step: what helps us answer. */
  hint: string;
  placeholder: string;
  /** Which item the intake offers to link, if any. */
  linked: LinkedKind | null;
  /** Attach the PostHog session replay URL to the conversation. */
  attachReplay?: true;
};

export const SUPPORT_CATEGORIES: readonly SupportCategory[] = [
  {
    id: "bookings",
    label: "Bookings & guests",
    blurb: "Reservations, guests, no-shows",
    hint: "Pick the booking, or mention the guest name and stay dates.",
    placeholder: "What's happening with this booking?",
    linked: "booking",
  },
  {
    id: "payments",
    label: "Payments & payouts",
    blurb: "Charges, refunds, payouts",
    hint: "Pick the booking and tell us the amount you expected.",
    placeholder: "Which payment or payout is this about?",
    linked: "booking",
  },
  {
    id: "availability",
    label: "Availability & rates",
    blurb: "Calendar, prices, restrictions",
    hint: "Tell us which rooms and dates are affected.",
    placeholder: "What looks wrong in your calendar or rates?",
    linked: null,
  },
  {
    id: "listing",
    label: "Listing & content",
    blurb: "Photos, descriptions, details",
    hint: "Tell us which page or field looks wrong.",
    placeholder: "What would you like to change or fix?",
    linked: "listing",
  },
  {
    id: "account",
    label: "Account & access",
    blurb: "Team members, sign-in",
    hint: "Tell us who needs access, or what you see when signing in.",
    placeholder: "What are you trying to do?",
    linked: null,
  },
  {
    id: "broken",
    label: "Something's broken",
    blurb: "Errors, bugs, things not loading",
    hint: "Tell us what you clicked and what you expected. We attach a recording of this session so we can see it too.",
    placeholder: "What happened, and what did you expect?",
    linked: null,
    attachReplay: true,
  },
  {
    id: "other",
    label: "Other",
    blurb: "Anything else",
    hint: "Anything else about OpenBookings.",
    placeholder: "How can we help?",
    linked: null,
  },
];

export function findCategory(id: string | null | undefined): SupportCategory | undefined {
  return SUPPORT_CATEGORIES.find((category) => category.id === id);
}

export function categoryLabel(id: string): string {
  return findCategory(id)?.label ?? "Support request";
}

export const SUPPORT_MESSAGE_MAX = 2000;
