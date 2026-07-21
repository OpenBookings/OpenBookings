import { auth } from "@/lib/auth";
import { mintRealtimeToken } from "@/lib/realtime/token";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token, expiresAt } = mintRealtimeToken(session.user.id);
  return NextResponse.json({ token, expiresAt });
}
