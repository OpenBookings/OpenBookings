// apps/business/proxy.ts
import { NextRequest, NextResponse } from "next/server";
import { sessionForApp, sessionCookieNames } from "@openbookings/auth/server";
import { readAuthEnv } from "@openbookings/auth/env";
import { auth } from "@/lib/auth"; // from packages/auth
import { getOnboardingFacts, wizardInProgress } from "@/lib/onboarding-facts";
import { onboardingWallDecision } from "@/lib/onboarding-wall";
import { headers } from "next/headers";
import { withTransaction } from "@openbookings/db";
import { ensureDemoMembership, isTestingMode } from "@openbookings/demo";

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
    const facts = await getOnboardingFacts(session.user.id);
    // Testing mode: every host owns the demo organisation. Added here, ahead
    // of the wall, so a host's first dashboard request already counts it.
    // Outside testing mode a leftover membership has no effect.
    const testing = isTestingMode();
    let ensured = false;
    if (testing && !facts.hasDemoMembership) {
      await withTransaction((tx) => ensureDemoMembership(tx, { userId: session.user.id }));
      ensured = true;
    }
    const decision = onboardingWallDecision({
      path,
      hasCompletedOrg: facts.hasCompletedOrg,
      hasDemoMembership: testing && (facts.hasDemoMembership || ensured),
      wizardInProgress: wizardInProgress(facts),
    });
    if (decision !== "allow") {
      return NextResponse.redirect(new URL(decision, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/account/:path*",
    "/support/:path*",
    // Signing in before accepting an invitation; /invite sits outside the
    // onboarding wall on purpose (a new team member has no org yet).
    "/invite/:path*",
  ],
};
