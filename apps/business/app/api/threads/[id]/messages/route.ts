import { NextResponse } from "next/server";
import { messagingRoutes } from "@/lib/messaging";
import { getServerSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

/**
 * PII minimization (task 15): full guest contact detail only exists on the
 * single-thread view, so bulk scraping would look like many detail reads in
 * a short window. Cap detail reads per host account; the shared handler
 * still does participant authorization.
 */
const wrappedGet: typeof messagingRoutes.getThreadMessages = async (req, ctx) => {
  const session = await getServerSession();
  if (session) {
    const limit = checkRateLimit(`thread-detail:${session.user.id}`, 120, 10 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429 },
      );
    }
  }
  return messagingRoutes.getThreadMessages(req, ctx);
};

export const GET = wrappedGet;
export const POST = messagingRoutes.postThreadMessage;
