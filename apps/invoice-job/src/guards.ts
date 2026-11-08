/** The Stripe key and the database belong to different worlds: the job refuses to run. */
export class ModeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModeMismatchError";
  }
}

/**
 * Whether this run is live or test, refusing a mix (spec, guards). Live means
 * a live Stripe key (`sk_live_…`, or a restricted `rk_live_…`). The database
 * must be labelled explicitly: `INVOICE_DB_ENV` is exactly `production` or
 * `test`, and anything else, unset included, is refused. A live key against a
 * `test` database, or a test key against `production`, throws
 * `ModeMismatchError`: either would move real money for test data, or test
 * data into real invoices. A missing or unrecognised key throws as well.
 */
export function assertModeMatch(env: Record<string, string | undefined>): "live" | "test" {
  const key = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const live = /^(sk|rk)_live_/.test(key);
  if (!live && !/^(sk|rk)_test_/.test(key)) throw new Error("STRIPE_SECRET_KEY is neither a live nor a test secret key");

  const label = env.INVOICE_DB_ENV;
  if (label !== "production" && label !== "test") {
    throw new ModeMismatchError("Refusing to run: INVOICE_DB_ENV must be set to exactly 'production' or 'test' to say which database DATABASE_URL points at");
  }
  const production = label === "production";
  if (live && !production) {
    throw new ModeMismatchError("Refusing to run: a live Stripe key against a database labelled 'test' (INVOICE_DB_ENV)");
  }
  if (!live && production) {
    throw new ModeMismatchError("Refusing to run: a test Stripe key against the production database (INVOICE_DB_ENV is 'production')");
  }
  return live ? "live" : "test";
}
