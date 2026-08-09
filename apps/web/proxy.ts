// apps/web/proxy.ts
import { NextRequest, NextResponse } from "next/server";
import { sessionForApp, sessionCookieNames } from "@openbookings/auth/server";
import { readAuthEnv } from "@openbookings/auth/env";
import { auth } from "@/lib/auth"; // from packages/auth
import { headers } from "next/headers";

const env = readAuthEnv();
const secureCookies = env.AUTH_BASE_URL.startsWith("https://");

export async function proxy(request: NextRequest) {
  const rawSession = await auth.api.getSession({
    headers: await headers(),
  });

  if (!rawSession) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Re-check account_type and portal on every request: the sign-in-time hook
  // never sees an already-issued cookie carried over from the host app.
  const session = sessionForApp(rawSession, "private");
  if (!session) {
    // Expire this app's session cookies so a host-app session doesn't bounce
    // every request through this redirect. __Host- cookies can only be
    // expired by a Set-Cookie satisfying the same prefix rules.
    const response = NextResponse.redirect(new URL("/", request.url));
    for (const name of sessionCookieNames(env.AUTH_COOKIE_PREFIX, secureCookies)) {
      response.cookies.set(name, "", {
        maxAge: 0,
        path: "/",
        secure: secureCookies,
      });
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Explicit allowlist of protected prefixes. /bookings is currently a dead
  // stub; it is gated here so it is protected from the moment it goes live.
  matcher: ["/bookings/:path*"],
};
