import { stripe } from "@openbookings/stripe";
import { query } from "@openbookings/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "account.updated") {
    const account = event.data.object;
    const currentlyDue = account.requirements?.currently_due ?? [];
    if (currentlyDue.length === 0 && account.charges_enabled) {
      await query(
        `UPDATE host_onboarding
         SET onboarding_completed_at = NOW()
         WHERE step_data->>'stripe_account_id' = $1
           AND onboarding_completed_at IS NULL`,
        [account.id]
      );
    }
  }

  return NextResponse.json({ received: true });
}
