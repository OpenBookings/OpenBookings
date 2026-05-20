import { auth } from "@/lib/auth";
import { queryOne } from "@openbookings/db";
import { retrieveConnectAccount } from "@openbookings/stripe";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await queryOne<{
    completed_steps: string[];
    stripe_account_id: string | null;
    onboarding_completed_at: string | null;
  }>(
    `SELECT completed_steps,
            step_data->>'stripe_account_id' AS stripe_account_id,
            onboarding_completed_at
     FROM host_onboarding WHERE user_id = $1`,
    [session.user.id]
  );

  const completed = new Set(row?.completed_steps ?? []);

  const steps = {
    coreInfoText: completed.has("core-info-text"),
    coreInfoLocation: completed.has("core-info-location"),
    legalNBoring: completed.has("legal-n-boring"),
  };

  let stripeStatus = null;
  if (row?.stripe_account_id) {
    const account = await retrieveConnectAccount(row.stripe_account_id);
    stripeStatus = {
      accountId: account.id,
      currentlyDue: account.requirements?.currently_due ?? [],
      eventuallyDue: account.requirements?.eventually_due ?? [],
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
    };
  }

  return NextResponse.json({
    steps,
    stripe: stripeStatus,
    onboardingCompleted: !!row?.onboarding_completed_at,
  });
}
