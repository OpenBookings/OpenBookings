const LIVE_KEY_PREFIX = "sk_live_";

/**
 * Refuses to start with a live Stripe key while the commission is switched
 * off. STRIPE_APPLICATION_FEE_ENABLED gates every application fee (the quote
 * and checkout read it), and it defaults to off so test setups never take a
 * fee. In production that default would silently charge hosts no commission
 * at all, so a live key requires it to be set to "true".
 */
export function assertApplicationFeeSafe(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const live = (env.STRIPE_SECRET_KEY ?? "").startsWith(LIVE_KEY_PREFIX);
  if (live && env.STRIPE_APPLICATION_FEE_ENABLED !== "true") {
    throw new Error(
      `A live Stripe key (${LIVE_KEY_PREFIX}…) requires STRIPE_APPLICATION_FEE_ENABLED=true, or no commission is taken. Refusing to start.`,
    );
  }
}
