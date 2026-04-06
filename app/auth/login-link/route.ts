import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkRateLimit, getClientIP } from "@/lib/rateLimit"
import { getPostHogClient } from "@/lib/posthog-server"

/**
 * POST /auth/login-link
 *
 * Generates a Better Auth magic link and sends it via Postmark.
 *
 * Request body: { email: string }
 * Response: { success: true } or error
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      )
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      )
    }

    const { email } = body as { email?: unknown }

    // Validate email
    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      )
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      )
    }

    // Normalize email (lowercase)
    const normalizedEmail = email.toLowerCase().trim()

    // Rate limiting: 3 requests per 10 minutes per email
    const emailRateLimit = checkRateLimit(
      `email:${normalizedEmail}`,
      3,
      10 * 60 * 1000 // 10 minutes
    )

    if (!emailRateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests. Please wait before requesting another link.",
          resetTime: emailRateLimit.resetTime,
        },
        { status: 429 }
      )
    }

    // Rate limiting: 5 requests per 10 minutes per IP
    const clientIP = getClientIP(request)
    const ipRateLimit = checkRateLimit(
      `ip:${clientIP}`,
      5,
      10 * 60 * 1000 // 10 minutes
    )

    if (!ipRateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests from this IP. Please try again later.",
          resetTime: ipRateLimit.resetTime,
        },
        { status: 429 }
      )
    }

    // Trigger Better Auth magic link — this calls sendMagicLink (Postmark) internally
    try {
      await auth.api.signInMagicLink({
        headers: request.headers,
        body: {
          email: normalizedEmail,
          callbackURL: "/auth/verify",
        },
      })
    } catch {
      return NextResponse.json(
        { error: "Failed to send email" },
        { status: 500 }
      )
    }

    // PostHog tracking — must not turn a successful send into a 500
    let posthog: ReturnType<typeof getPostHogClient> | null = null
    try {
      posthog = getPostHogClient()
    } catch {
      // Ignore analytics initialization failures.
    }

    if (posthog) {
      try {
        posthog.capture({
          distinctId: normalizedEmail,
          event: "magic_link_sent",
          properties: { email: normalizedEmail },
        })
      } catch {
        // Ignore analytics event failures.
      }

      try {
        await posthog.shutdown()
      } catch {
        // Ignore analytics shutdown failures.
      }
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "An error occurred. Please try again later." },
      { status: 500 }
    )
  }
}
