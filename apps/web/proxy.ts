// apps/web/proxy.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth"; // from packages/auth
import { headers } from "next/headers";

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session.user.account_type !== "private") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Explicit allowlist of protected prefixes. /bookings is currently a dead
  // stub; it is gated here so it is protected from the moment it goes live.
  matcher: ["/bookings/:path*"],
};
