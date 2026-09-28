import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit, getClientIP } from "@/lib/rateLimit";
import { queryOne } from "@openbookings/db";
import { getPostHogClient } from "@openbookings/analytics/server";
import { resolveCallbackPath, resolveCallbackURL } from "@openbookings/auth/callback-url";

const APP_URL = process.env.NEXT_PUBLIC_BUSINESS_URL || "https://business.openbookings.co";

/**
 * Where the emailed link lands when the request named no destination, or named
 * one we refused. Not the origin root: that is the marketing page, whereas
 * /login carries the session check that forwards a host on to /onboarding or
 * /dashboard. Signing in successfully and landing on the sales pitch reads as
 * a failure.
 */
const DEFAULT_CALLBACK_PATH = "/login";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, callbackURL } = body as { email?: unknown; callbackURL?: unknown };

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const atIndex = email.indexOf("@");
  const isValidEmail =
    email.length <= 254 &&
    atIndex > 0 &&
    atIndex < email.length - 1 &&
    email.indexOf(".", atIndex) > atIndex + 1;
  if (!isValidEmail) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const emailRateLimit = checkRateLimit(`email:${normalizedEmail}`, 3, 10 * 60 * 1000);
  if (!emailRateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before requesting another link.", resetTime: emailRateLimit.resetTime },
      { status: 429 }
    );
  }

  const ipRateLimit = checkRateLimit(`ip:${getClientIP(request)}`, 5, 10 * 60 * 1000);
  if (!ipRateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests from this IP. Please try again later.", resetTime: ipRateLimit.resetTime },
      { status: 429 }
    );
  }

  // Block sign-in attempts from private accounts before sending the link
  try {
    const existingUser = await queryOne<{ account_type: string | null }>(
      `SELECT account_type FROM "user" WHERE email = $1`,
      [normalizedEmail]
    );
    if (existingUser?.account_type && existingUser.account_type !== "business") {
      return NextResponse.json(
        { error: "This email address is associated with a private account. Please retry with a business email." },
        { status: 403 }
      );
    }
  } catch {
    // If the DB check fails, allow the request through — auth will enforce it
  }

  try {
    await auth.api.signInMagicLink({
      headers: request.headers,
      body: {
        email: normalizedEmail,
        // Inner call collapses "absent" and "refused" to /login; outer call
        // turns the surviving path into the absolute URL the email needs.
        callbackURL: resolveCallbackURL(
          resolveCallbackPath(callbackURL, DEFAULT_CALLBACK_PATH),
          APP_URL,
        ),
      },
    });
  } catch (err) {
    console.error("[login-link] signInMagicLink failed:", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  try {
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: normalizedEmail,
      event:"business_magic_link_sent",
      properties: { email: normalizedEmail },
    });
    await posthog.shutdown();
  } catch {
    // analytics must not affect response
  }

  return NextResponse.json({ success: true });
}
