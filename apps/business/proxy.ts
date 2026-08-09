// apps/business/proxy.ts
import { NextRequest, NextResponse } from "next/server";
import { sessionForApp, sessionCookieNames } from "@openbookings/auth/server";
import { readAuthEnv } from "@openbookings/auth/env";
import { auth } from "@/lib/auth"; // from packages/auth
import { queryOne } from "@openbookings/db";
import { headers } from "next/headers";

const env = readAuthEnv();
const secureCookies = env.AUTH_BASE_URL.startsWith("https://");

/**
 * Redirect to /login and expire this app's session cookies. Without the
 * expiry, a guest-app session cookie presented here would bounce every
 * request through this redirect instead of landing on a clean sign-in.
 * __Host- cookies can only be expired by a Set-Cookie that satisfies the
 * same prefix rules (Secure, Path=/, no Domain).
 */
function redirectToLogin(request: NextRequest, withRedirectParam: boolean) {
  const loginUrl = new URL("/login", request.url);
  if (withRedirectParam) {
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
  }
  const response = NextResponse.redirect(loginUrl);
  for (const name of sessionCookieNames(env.AUTH_COOKIE_PREFIX, secureCookies)) {
    response.cookies.set(name, "", {
      maxAge: 0,
      path: "/",
      secure: secureCookies,
    });
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const rawSession = await auth.api.getSession({
    headers: await headers(),
  });

  if (!rawSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Re-check account_type and portal on every request: the sign-in-time hook
  // never sees an already-issued cookie carried over from the guest app.
  const session = sessionForApp(rawSession, "business");
  if (!session) {
    return redirectToLogin(request, false);
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
