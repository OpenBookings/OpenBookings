import { after } from "next/server";
import { clickResponse } from "@/lib/email-tracking/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return clickResponse(token, request.headers.get("user-agent"), after);
}
