/**
 * Deletes every connected account in Stripe TEST mode.
 *
 * Why: the dashboard type of a connected account cannot be changed after it is
 * created. The accounts made before the move to full-dashboard accounts are
 * the wrong kind and have to go; test hosts then onboard again.
 *
 * DESTRUCTIVE. Refuses to run with anything but a test-mode secret key, and
 * does nothing without --confirm (it lists what it would delete).
 *
 * After running it, clear the stored ids so affected hosts are sent back to
 * the Stripe onboarding step (run by hand against the same environment):
 *
 *   UPDATE host_onboarding SET step_data = step_data - 'stripe_account_id',
 *          onboarding_completed_at = NULL;
 *   UPDATE properties  SET stripe_account_id = NULL;
 *   UPDATE org_profile SET stripe_account_id = NULL;
 *
 * Run: bun --env-file=../../.env.local packages/stripe/scripts/discard-test-accounts.ts [--confirm]
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("Refusing to run: STRIPE_SECRET_KEY is not a test-mode key.");
  process.exit(1);
}

const confirm = process.argv.includes("--confirm");
const stripe = new Stripe(key);

let count = 0;
for await (const account of stripe.accounts.list({ limit: 100 })) {
  count++;
  const label = `${account.id}  ${account.email ?? "(no email)"}  dashboard=${account.controller?.stripe_dashboard?.type ?? "?"}`;
  if (!confirm) {
    console.log("would delete", label);
    continue;
  }
  try {
    await stripe.accounts.del(account.id);
    console.log("deleted", label);
  } catch (error) {
    console.error("FAILED ", label, error instanceof Error ? error.message : error);
  }
}

console.log(
  confirm ? `Done: ${count} account(s) processed.` : `${count} account(s) would be deleted. Re-run with --confirm.`,
);
