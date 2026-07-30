import { auth } from "@/lib/auth";
import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

// Reads per-request auth headers — must never be statically cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Issues a PostHog Support identity-verification signature for the current user.
 *
 * PostHog conversations verify ticket ownership with an HMAC-SHA256 of the
 * user's distinct_id, keyed by the project's secret API token. The secret must
 * only ever live on the server, so the browser fetches the signed pair from
 * here and hands it to `posthog.setIdentity(distinctId, hash)`.
 */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.POSTHOG_SECRET_API_TOKEN;
  if (!secret) {
    // Identity verification isn't configured; the client falls back to the
    // anonymous widget session rather than breaking ticket creation.
    return NextResponse.json(
      { error: "Identity verification is not configured" },
      { status: 501 }
    );
  }

  const distinctId = session.user.id;
  const hash = createHmac("sha256", secret).update(distinctId).digest("hex");

  return NextResponse.json(
    { distinctId, hash },
    { headers: { "Cache-Control": "no-store" } }
  );
}
