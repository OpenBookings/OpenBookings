type GateEnv = { ADMIN_SUPER_MODE?: string; NODE_ENV?: string };

/** Super-admin mode is on only with ADMIN_SUPER_MODE exactly "1" in development. */
export function isSuperAdminEnabled(env: GateEnv = process.env): boolean {
  return env.ADMIN_SUPER_MODE === "1" && env.NODE_ENV === "development";
}

export class SuperAdminDisabledError extends Error {
  constructor() {
    super("Super admin mode is disabled");
    this.name = "SuperAdminDisabledError";
  }
}

/** Call first in every page and server action. */
export function requireSuperAdmin(): void {
  if (!isSuperAdminEnabled()) throw new SuperAdminDisabledError();
}

export function databaseHost(url: string | undefined): string {
  if (!url) return "unknown";
  try {
    return new URL(url).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

/** Real actions touch Stripe, so they run only against a test-mode key. */
export function isStripeTestMode(env: Record<string, string | undefined> = process.env): boolean {
  return typeof env.STRIPE_SECRET_KEY === "string" && env.STRIPE_SECRET_KEY.startsWith("sk_test_");
}
