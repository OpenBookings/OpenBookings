import { after } from "next/server";
import { NO_CAPTURE, clickResponse } from "@/lib/email-tracking/respond";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Context) {
  const { token } = await params;
  return clickResponse(token, request.headers.get("user-agent"), after);
}

/** Link checkers and prefetchers send HEAD: same redirect, no click captured. */
export async function HEAD(_request: Request, { params }: Context) {
  const { token } = await params;
  return clickResponse(token, null, NO_CAPTURE);
}
