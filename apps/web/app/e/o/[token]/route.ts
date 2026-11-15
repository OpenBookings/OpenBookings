import { after } from "next/server";
import { NO_CAPTURE, openResponse } from "@/lib/email-tracking/respond";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Context) {
  const { token } = await params;
  return openResponse(token, request.headers.get("user-agent"), after);
}

/** Link checkers and prefetchers send HEAD: same response, no open captured. */
export async function HEAD(_request: Request, { params }: Context) {
  const { token } = await params;
  return openResponse(token, null, NO_CAPTURE);
}
