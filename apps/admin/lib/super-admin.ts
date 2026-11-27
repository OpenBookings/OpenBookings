type GateEnv = { ADMIN_SUPER_MODE?: string; NODE_ENV?: string };

/** The development bypass is on only with ADMIN_SUPER_MODE exactly "1" in development. */
export function isSuperAdminEnabled(env: GateEnv = process.env): boolean {
  return env.ADMIN_SUPER_MODE === "1" && env.NODE_ENV === "development";
}

export function databaseHost(url: string | undefined): string {
  if (!url) return "unknown";
  try {
    return new URL(url).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

export const NOT_TEST_MODE = "Stripe is not in test mode here, so real booking actions are off.";

/**
 * Production runs with the live Stripe key. Anywhere else a live key is
 * refused: only sk_test_ / rk_test_ keys may move (test) money.
 */
export function stripeKeyAllowed(
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; error: string } {
  if (env.NODE_ENV === "production") return { ok: true };
  const key = env.STRIPE_SECRET_KEY;
  if (typeof key === "string" && (key.startsWith("sk_test_") || key.startsWith("rk_test_"))) return { ok: true };
  return { ok: false, error: NOT_TEST_MODE };
}
