import { NextRequest, NextResponse } from "next/server"
import { createMagicLink } from "@/lib/firebase/firebaseAdmin"
import { sendMagicLink } from "@/lib/mailing/magic-link"
import { checkRateLimit, getClientIP } from "@/lib/rateLimit"

/**
 * POST /api/auth/login-link
 *
 * Generates a Firebase magic link and sends it via Postmark.
 *
 * Request body: { email: string }
 * Response: { success: true } or error
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email } = body

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

    // Generate magic link
    const magicLink = await createMagicLink(normalizedEmail)

    // Send email
    try {
      await sendMagicLink(normalizedEmail, magicLink)
    } catch (emailError) {
      console.error("Failed to send email:", emailError)
      // Don't expose email service errors to client
      return NextResponse.json(
        { error: "Failed to send email. Error: " + emailError },
        { status: 500 }
      )
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Login link generation error:", error)
    return NextResponse.json(
      { error: "An error occurred. Please try again later." },
      { status: 500 }
    )
  }
}
