import { auth } from "@/lib/auth";
import { queryOne } from "@openbookings/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HOST_STEPS } from "./steps";

export default async function OnboardingRouter() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const row = await queryOne<{ completed_steps: string[] }>(
    `SELECT completed_steps FROM host_onboarding WHERE user_id = $1`,
    [session.user.id]
  );

  const completed = new Set(row?.completed_steps ?? []);
  const next = HOST_STEPS.find((s) => !completed.has(s)) ?? HOST_STEPS[0];

  redirect(`/onboarding/${next}`);
  return null;
}
