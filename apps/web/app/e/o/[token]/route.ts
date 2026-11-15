import { after } from "next/server";
import { openResponse } from "@/lib/email-tracking/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return openResponse(token, request.headers.get("user-agent"), after);
}
