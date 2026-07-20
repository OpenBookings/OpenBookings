import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import {
  getOnboardingRow,
  getOnboardingStatus,
} from "@/app/(onboarding)/onboarding/_lib/status";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await getOnboardingRow(session.user.id);
  return NextResponse.json(await getOnboardingStatus(row));
}
