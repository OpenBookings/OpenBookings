/**
 * The surfaces a Turnstile token can be minted for: the widget (the browser,
 * ./use-turnstile-token.ts) and the check (the server, ./turnstile.ts) must
 * name the same one. Cloudflare allows [A-Za-z0-9_-], at most 32 characters.
 * Free of server code, so client components can import it.
 */
export const TURNSTILE_ACTIONS = {
  checkout: 'checkout',
  reviewReport: 'review_report',
} as const;

export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
