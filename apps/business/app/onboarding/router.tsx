import { getServerSession } from "@/lib/auth";
import { queryOne } from "@openbookings/db";
import { redirect } from "next/navigation";

export default async function OnboardingRouter() {
  // proxy.ts already guarantees a valid, business-typed session for every
  // request under /onboarding/*, so this only needs the user id.
  const session = await getServerSession();

  const row = await queryOne<{
    completed_steps: string[];
    onboarding_completed_at: string | null;
    stripe_account_id: string | null;
  }>(
    `SELECT completed_steps,
            onboarding_completed_at,
            step_data->>'stripe_account_id' AS stripe_account_id
     FROM host_onboarding WHERE user_id = $1`,
    [session!.user.id]
  );

  if (row?.onboarding_completed_at) {
    redirect("/dashboard");
  }

  const completed = new Set(row?.completed_steps ?? []);
  const DATA_STEPS = ["core-info-text", "core-info-location", "legal-n-boring"] as const;
  const nextData = DATA_STEPS.find((s) => !completed.has(s));
  if (nextData) redirect(`/onboarding/${nextData}`);

  if (!row?.stripe_account_id) redirect("/onboarding/stripe-connect");

  redirect("/onboarding/verify");
  return null;
}
