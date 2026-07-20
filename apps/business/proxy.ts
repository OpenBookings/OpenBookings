// apps/business/proxy.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth"; // from packages/auth
import { queryOne } from "@openbookings/db";
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

  // Route users to the right side of the onboarding wall here, before any
  // page renders: redirect()s inside pages that sit under a loading.tsx
  // boundary get turned into streamed client-side redirects, which trips a
  // React bug during chained navigations (vercel/next.js#63121).
  const path = request.nextUrl.pathname;
  if (path.startsWith("/dashboard") || path.startsWith("/onboarding")) {
    const row = await queryOne<{ onboarding_completed_at: string | null }>(
      `SELECT onboarding_completed_at FROM host_onboarding WHERE user_id = $1`,
      [session.user.id]
    );
    const completed = !!row?.onboarding_completed_at;

    if (path.startsWith("/dashboard") && !completed) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }
    if (path.startsWith("/onboarding") && completed) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/account/:path*",
  ],
};