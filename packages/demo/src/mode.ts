const TEST_KEY_PREFIX = "sk_test_";

function hasTestKey(env: NodeJS.ProcessEnv): boolean {
  return (env.STRIPE_SECRET_KEY ?? "").startsWith(TEST_KEY_PREFIX);
}

/** Testing mode needs TESTING=true and a Stripe test-mode secret key. */
export function isTestingMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TESTING === "true" && hasTestKey(env);
}

/** Refuses to start when TESTING=true is combined with a non-test Stripe key. */
export function assertTestingModeSafe(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.TESTING === "true" && !hasTestKey(env)) {
    throw new Error(
      `TESTING=true requires a Stripe test key (STRIPE_SECRET_KEY starting with ${TEST_KEY_PREFIX}). Refusing to start.`,
    );
  }
}
