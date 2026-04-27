// apps/business/proxy.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth"; // from packages/auth
import { headers } from "next/headers";

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session.user.account_type !== "business") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/properties/:path*",
    "/analytics/:path*",
    "/account/:path*",
  ],
};