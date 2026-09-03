/**
 * Every way the checkout can fail, and what the guest is told about it.
 *
 * Two rules hold throughout this file:
 *
 * 1. Raw Stripe messages never reach the guest. They leak integration detail
 *    ("No such destination: acct_…", "Invalid API Key provided") and read as
 *    nonsense to someone trying to book a room. The real error goes to
 *    Sentry; the guest gets a sentence they can act on.
 * 2. We never tell a guest they haven't been charged unless we know it.
 *    Claiming that after a failure we couldn't verify is what makes someone
 *    pay twice for the same room.
 */

/**
 * Why creating the Checkout Session failed. The route sends the code, not the
 * message, so the copy can change without touching the API contract.
 */
export type CheckoutErrorCode =
  /** Keys, Connect account or app URL are wrong. Retrying cannot help. */
  | 'config_error'
  /** The booking itself is not chargeable — zero total, fee above total. */
  | 'booking_invalid'
  /** Stripe refused the request for a reason we haven't classified. */
  | 'session_failed'
  /** We could not reach Stripe at all, or the browser could not reach us. */
  | 'stripe_unreachable'
  /** Stripe is rate limiting us. Worth retrying, but not immediately. */
  | 'rate_limited';

export type CheckoutErrorCopy = {
  message: string;
  /** Whether offering a "Try again" button is honest. */
  retryable: boolean;
};

const CHECKOUT_ERRORS: Record<CheckoutErrorCode, CheckoutErrorCopy> = {
  config_error: {
    message:
      "This property can't take bookings right now. Nothing has been charged — please contact the host directly.",
    retryable: false,
  },
  booking_invalid: {
    message:
      "We couldn't price this booking. Nothing has been charged — please start again from the room page.",
    retryable: false,
  },
  session_failed: {
    message: "We couldn't start the payment. Nothing has been charged — please try again.",
    retryable: true,
  },
  stripe_unreachable: {
    message:
      "We couldn't reach our payment provider. Check your connection and try again — nothing has been charged.",
    retryable: true,
  },
  rate_limited: {
    message: 'Our payment provider is busy. Wait a few seconds and try again.',
    retryable: true,
  },
};

/** Copy for a code off the wire, which may be absent or something we removed. */
export function checkoutErrorCopy(code: unknown): CheckoutErrorCopy {
  if (typeof code === 'string' && code in CHECKOUT_ERRORS) {
    return CHECKOUT_ERRORS[code as CheckoutErrorCode];
  }
  return CHECKOUT_ERRORS.session_failed;
}

/**
 * Stripe API error codes we can say something specific about, mapped onto our
 * own. `StripeInvalidRequestError` covers everything from "this amount is too
 * small" to "that Connect account doesn't exist", and the distinction decides
 * whether the guest is told to retry or to give up and contact the host.
 *
 * https://docs.stripe.com/error-codes
 */
const STRIPE_CODE_TO_CHECKOUT_CODE: Record<string, CheckoutErrorCode> = {
  // The booking is priced in a way Stripe will never accept.
  amount_too_small: 'booking_invalid',
  amount_too_large: 'booking_invalid',
  invalid_charge_amount: 'booking_invalid',
  parameter_invalid_integer: 'booking_invalid',
  parameter_missing: 'booking_invalid',
  parameter_invalid_empty: 'booking_invalid',
  parameter_unknown: 'booking_invalid',
  parameters_exclusive: 'booking_invalid',
  url_invalid: 'booking_invalid',

  // Keys, modes and the Connect account. Every one of these is a deployment
  // problem the guest cannot retry their way out of.
  api_key_expired: 'config_error',
  secret_key_required: 'config_error',
  livemode_mismatch: 'config_error',
  testmode_charges_only: 'config_error',
  account_invalid: 'config_error',
  platform_account_required: 'config_error',
  platform_api_key_expired: 'config_error',
  payouts_not_allowed: 'config_error',
  transfers_not_allowed: 'config_error',
  not_allowed_on_standard_account: 'config_error',
  capability_not_active: 'config_error',
  // The destination Connect account id points at nothing.
  resource_missing: 'config_error',
  country_unsupported: 'config_error',
  stripe_tax_inactive: 'config_error',

  // Transient. Worth another go.
  rate_limit: 'rate_limited',
  card_decline_rate_limit_exceeded: 'rate_limited',
  lock_timeout: 'session_failed',
  idempotency_key_in_use: 'session_failed',
  processing_error: 'session_failed',
};

/**
 * Maps a thrown error from the Stripe Node SDK onto one of our codes.
 *
 * Reads `err.type` rather than `instanceof`: the SDK sets it on every error it
 * raises, and matching on a string survives a duplicated `stripe` package in
 * the dependency tree, where `instanceof` quietly stops matching.
 */
export function classifyStripeError(err: unknown): CheckoutErrorCode {
  const type = (err as { type?: unknown })?.type;

  // The specific code beats the broad type: an `amount_too_small` is a broken
  // booking, not the "try again" that `StripeInvalidRequestError` would get.
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && code in STRIPE_CODE_TO_CHECKOUT_CODE) {
    return STRIPE_CODE_TO_CHECKOUT_CODE[code];
  }

  switch (type) {
    // Bad or missing secret key, and Connect accounts we aren't allowed to
    // charge on behalf of. Both are ours to fix, never the guest's.
    case 'StripeAuthenticationError':
    case 'StripePermissionError':
      return 'config_error';
    case 'StripeConnectionError':
      return 'stripe_unreachable';
    case 'StripeRateLimitError':
      return 'rate_limited';
    default:
      break;
  }

  // Thrown by the lazy client in `@openbookings/stripe` before any request is
  // made, so it carries no Stripe `type` to match on.
  if (err instanceof Error && err.message.includes('STRIPE_SECRET_KEY')) {
    return 'config_error';
  }

  return 'session_failed';
}

/* -------------------------------------------------------------------------
 * Client-side: Stripe.js results
 * ---------------------------------------------------------------------- */

/**
 * `js.stripe.com` never loaded. Overwhelmingly this is a blocker extension or
 * a corporate proxy rather than an outage, so the copy names that first — a
 * bare "try again" leaves the guest repeating something that cannot work.
 */
export const STRIPE_JS_UNAVAILABLE: CheckoutErrorCopy = {
  message:
    "We couldn't load the secure payment form. An ad blocker or privacy extension is the usual cause — allow js.stripe.com for this page, then try again.",
  retryable: true,
};

/**
 * The hold ran out while the page was open. Retryable, but only in the sense
 * that a fresh Session is worth asking for — the old one is unusable.
 */
export const CHECKOUT_EXPIRED: CheckoutErrorCopy = {
  message:
    'Your room was only held for a short while and that hold has now lapsed. Nothing has been charged — start again to check whether it is still free.',
  retryable: true,
};

/** Stripe.js loaded but an Element inside the form never rendered. */
export const ELEMENT_LOAD_FAILED: CheckoutErrorCopy = {
  message:
    "Part of the payment form didn't load, so we can't take your details safely. Reload the page, or disable any content blockers and try again.",
  retryable: true,
};

/** The session was already paid — a back button or a second tab. */
export const CHECKOUT_ALREADY_PAID: CheckoutErrorCopy = {
  message: 'This booking has already been paid. Do not pay again — check your email for the confirmation.',
  retryable: false,
};

/* -------------------------------------------------------------------------
 * Decline mapping
 *
 * Stripe's own `message` is written for a generic web shop and often says
 * nothing useful ("Your card was declined."). These are our words for each
 * documented decline code, so the guest is told what happened and what to do
 * next rather than being handed Stripe's shrug.
 *
 * https://docs.stripe.com/declines/codes
 * ---------------------------------------------------------------------- */

/**
 * The only thing we may say for declines that carry a fraud signal. Stripe
 * requires `fraudulent`, `lost_card`, `stolen_card`, `merchant_blacklist` and
 * `pickup_card` be presented exactly as an ordinary decline: telling someone
 * their card is flagged tips off the person holding a card that isn't theirs.
 */
const GENERIC_DECLINE =
  "Your bank declined this payment and didn't tell us why. Try another card or payment method, or contact your bank.";

const CONTACT_BANK =
  'Your bank declined this payment. Contact them for the reason, or try another card or payment method.';
const USE_ANOTHER_CARD = 'Try another card or payment method.';
const RETRY_NOW = 'Wait a moment and try again. If it keeps failing, try another card.';
const CHECK_CARD_DETAILS = 'Check the card details and try again.';

const DECLINE_MESSAGES: Record<string, string> = {
  // Fraud signals — all must read as an ordinary decline.
  fraudulent: GENERIC_DECLINE,
  lost_card: GENERIC_DECLINE,
  stolen_card: GENERIC_DECLINE,
  lost_or_stolen_card: GENERIC_DECLINE,
  merchant_blacklist: GENERIC_DECLINE,
  pickup_card: GENERIC_DECLINE,
  generic_decline: GENERIC_DECLINE,

  // Money on the card.
  insufficient_funds: `There isn't enough money on that card to cover the booking. ${USE_ANOTHER_CARD}`,
  card_velocity_exceeded: `That card has hit a spending or transaction limit set by your bank. ${USE_ANOTHER_CARD}`,
  withdrawal_count_limit_exceeded: `That card has hit a limit set by your bank. ${USE_ANOTHER_CARD}`,
  invalid_amount: 'Your bank would not approve an amount this size. Contact them, or use another card.',

  // Details the guest typed wrong, and can fix in place.
  incorrect_cvc: 'That security code is wrong. Check the three digits on the back of the card.',
  invalid_cvc: 'That security code is wrong. Check the three digits on the back of the card.',
  incorrect_number: `That card number is wrong. ${CHECK_CARD_DETAILS}`,
  invalid_number: `That card number is wrong. ${CHECK_CARD_DETAILS}`,
  invalid_expiry_month: `That expiry date is wrong. ${CHECK_CARD_DETAILS}`,
  invalid_expiry_year: `That expiry date is wrong. ${CHECK_CARD_DETAILS}`,
  incorrect_zip: "The postcode doesn't match the one your bank holds for this card. Check the billing address above.",
  incorrect_address: "The billing address doesn't match the one your bank holds for this card. Check it above.",

  // The card itself is unusable.
  expired_card: `That card has expired. ${USE_ANOTHER_CARD}`,
  card_not_supported: `That card can't be used for this kind of payment. ${USE_ANOTHER_CARD}`,
  currency_not_supported: `That card can't be charged in this currency. ${USE_ANOTHER_CARD}`,
  invalid_account: CONTACT_BANK,
  new_account_information_available: CONTACT_BANK,
  restricted_card: CONTACT_BANK,

  // Worth trying again — nothing is wrong with the card.
  approve_with_id: RETRY_NOW,
  issuer_not_available: "We couldn't reach your bank to authorise the payment. Wait a moment and try again.",
  processing_error: "Something went wrong at your bank's end. Wait a moment and try again.",
  reenter_transaction: RETRY_NOW,
  try_again_later: RETRY_NOW,

  // Authentication.
  authentication_required: 'Your bank needs to confirm it is you. Try again and complete the verification step.',
  authentication_not_handled: 'Your bank needs to confirm it is you. Try again and complete the verification step.',
  mobile_device_authentication_required:
    'Your bank needs to confirm it is you. Try again and confirm with your phone.',

  // The one decline where retrying is the wrong advice.
  duplicate_transaction:
    'Your bank blocked this as a duplicate of a payment made moments ago. Check your email for a confirmation before trying again — you may already have booked.',

  // Declined with no reason given.
  call_issuer: CONTACT_BANK,
  do_not_honor: CONTACT_BANK,
  do_not_try_again: CONTACT_BANK,
  no_action_taken: CONTACT_BANK,
  not_permitted: CONTACT_BANK,
  transaction_not_allowed: CONTACT_BANK,
  service_not_allowed: CONTACT_BANK,
  security_violation: CONTACT_BANK,
  stop_payment_order: CONTACT_BANK,
  revocation_of_authorization: CONTACT_BANK,
  revocation_of_all_authorizations: CONTACT_BANK,

  // Only reachable with a test card against test keys.
  testmode_decline: 'That is a test card number. A real card is needed to complete a booking.',

  // Non-card methods — iDEAL, Bancontact, Klarna and friends.
  partner_generic_decline: `Your payment provider declined this payment. ${USE_ANOTHER_CARD}`,
  invalid_customer_account:
    "We couldn't charge that account. Sort it out with your payment provider, then try again.",
  payment_limit_exceeded: `This booking is over a limit on your account. ${USE_ANOTHER_CARD}`,
  invalid_billing_agreement: `That payment method is no longer authorised. ${USE_ANOTHER_CARD}`,
  invalid_payment_information: `Those payment details were rejected. ${USE_ANOTHER_CARD}`,
  expired_payment_information: `Those payment details have expired. ${USE_ANOTHER_CARD}`,
  invalid_authorization: `That payment was never authorised. ${USE_ANOTHER_CARD}`,
  partner_high_risk_customer: `Your payment provider declined this payment. ${USE_ANOTHER_CARD}`,
  compliance_violation: `Your payment provider declined this payment. ${USE_ANOTHER_CARD}`,
  recurring_not_supported_by_bank: `Your bank doesn't support this kind of payment. ${USE_ANOTHER_CARD}`,
  partner_payment_not_found: RETRY_NOW,
  partner_action_not_supported: `Your payment provider doesn't support this. ${USE_ANOTHER_CARD}`,
};

/** A message with any leading/trailing slack removed, or null if it was empty. */
function cleaned(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type ConfirmErrorLike = {
  code?: string | null;
  message?: string;
  paymentFailed?: { declineCode?: string | null };
};

/**
 * Our words for a Stripe decline code, for callers holding one directly rather
 * than a `confirm()` result — the return page reading
 * `payment_intent.last_payment_error`, for instance.
 *
 * Strict on purpose: returns null for a code we have no words for, so the
 * caller can fall back to its own copy instead of being handed a generic line
 * it cannot tell apart from a real mapping. Many API error codes
 * (`expired_card`, `incorrect_cvc`, `processing_error`) share a name with the
 * decline code, so this resolves both.
 */
export function describeDeclineCode(declineCode: string | null | undefined): string | null {
  if (!declineCode) return null;
  return DECLINE_MESSAGES[declineCode] ?? null;
}

/**
 * True when a `confirm()` failure means the hold ran out rather than the
 * payment being refused, so the guest is sent to start over instead of
 * retrying against a session Stripe will keep rejecting.
 *
 * A decline can never be a lapsed hold, and the guard matters: an
 * `expired_card` decline reads "Your card has expired", so matching a bare
 * "expired" threw away the session of every guest whose card was out of date.
 * Both words must be present, which "card has expired" does not satisfy.
 */
export function isExpiredSessionError(error: ConfirmErrorLike): boolean {
  if (error.code === 'paymentFailed') return false;

  const message = cleaned(error.message)?.toLowerCase() ?? '';
  return (message.includes('session') && message.includes('expired')) ||
    message.includes('no longer available');
}
