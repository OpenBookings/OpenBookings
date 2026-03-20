import { NextRequest, NextResponse } from "next/server"
import { createHash, randomUUID } from "crypto"
import { createMagicLink } from "@/lib/firebase/firebaseAdmin"
import { sendMagicLink } from "@/lib/mailing/magic-link"
import { checkRateLimit, getClientIP } from "@/lib/rateLimit"
import { getPostHogClient } from "@/lib/posthog-server"

const LOG_ENABLED = true

function sha256Prefix(value: string, prefixLength = 12) {
  return createHash("sha256").update(value).digest("hex").slice(0, prefixLength)
}

function maskEmail(email: string) {
  // Avoid logging raw email in server logs; use a short hash for correlation.
  return `sha256:${sha256Prefix(email)}`
}

function maskIP(ip: string) {
  if (!ip || ip === "unknown") return ip
  if (ip.includes(":")) return `${ip.slice(0, 6)}...`
  const parts = ip.split(".")
  if (parts.length === 4) {
    parts[3] = "xxx"
    return parts.join(".")
  }
  return "redacted"
}

function logEvent(event: string, data?: Record<string, unknown>) {
  if (!LOG_ENABLED) return
  // Keep logs structured so you can grep by requestId/event.
  console.log(
    JSON.stringify({
      subsystem: "auth/login-link",
      event,
      ...data,
    })
  )
}

/**
 * POST /api/auth/login-link
 *
 * Generates a Firebase magic link and sends it via Postmark.
 *
 * Request body: { email: string }
 * Response: { success: true } or error
 */
export async function POST(request: NextRequest) {
  const requestId =
    request.headers.get("x-request-id") ??
    // Node runtime always has crypto; for local correlation this is fine.
    randomUUID()
  const startedAt = Date.now()
  let stage = "start:request"

  logEvent("request.received", {
    requestId,
    stage,
    method: request.method,
    url: request.url,
    contentType: request.headers.get("content-type"),
    userAgent: request.headers.get("user-agent"),
    acceptLanguage: request.headers.get("accept-language"),
    contentLength: request.headers.get("content-length"),
  })

  try {

    stage = "parse_json"
    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      logEvent("request.parse_json.failed", {
        requestId,
        stage,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }

    if (!body || typeof body !== "object") {
      logEvent("request.body.invalid_type", {
        requestId,
        stage,
        bodyType: typeof body,
      })
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      )
    }

    const { email } = body as { email?: unknown }

    stage = "validate_email_presence_and_type"
    // Validate email
    if (!email || typeof email !== "string") {
      logEvent("request.validate_email.invalid", {
        requestId,
        stage,
        email: email === undefined ? "undefined" : typeof email,
      })
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      )
    }

    stage = "validate_email_format"
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      logEvent("request.validate_email.format_invalid", {
        requestId,
        stage,
        email: maskEmail(email),
      })
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      )
    }

    stage = "normalize_email"
    // Normalize email (lowercase)
    const normalizedEmail = email.toLowerCase().trim()
    const emailId = maskEmail(normalizedEmail)

    stage = "rate_limit_email"
    // Rate limiting: 3 requests per 10 minutes per email
    const emailRateLimit = checkRateLimit(
      `email:${normalizedEmail}`,
      3,
      10 * 60 * 1000 // 10 minutes
    )
    logEvent("rate_limit.email", {
      requestId,
      stage,
      allowed: emailRateLimit.allowed,
      remaining: emailRateLimit.remaining,
      resetTime: emailRateLimit.resetTime,
      email: emailId,
    })

    if (!emailRateLimit.allowed) {
      logEvent("rate_limit.email.blocked", {
        requestId,
        stage,
        email: emailId,
        resetTime: emailRateLimit.resetTime,
      })
      return NextResponse.json(
        {
          error: "Too many requests. Please wait before requesting another link.",
          resetTime: emailRateLimit.resetTime,
        },
        { status: 429 }
      )
    }

    stage = "rate_limit_ip"
    // Rate limiting: 5 requests per 10 minutes per IP
    const clientIP = getClientIP(request)
    const ipRateLimit = checkRateLimit(
      `ip:${clientIP}`,
      5,
      10 * 60 * 1000 // 10 minutes
    )

    logEvent("rate_limit.ip", {
      requestId,
      stage,
      clientIP: maskIP(clientIP),
      allowed: ipRateLimit.allowed,
      remaining: ipRateLimit.remaining,
      resetTime: ipRateLimit.resetTime,
    })

    if (!ipRateLimit.allowed) {
      logEvent("rate_limit.ip.blocked", {
        requestId,
        stage,
        clientIP: maskIP(clientIP),
        resetTime: ipRateLimit.resetTime,
      })
      return NextResponse.json(
        {
          error: "Too many requests from this IP. Please try again later.",
          resetTime: ipRateLimit.resetTime,
        },
        { status: 429 }
      )
    }

    stage = "create_magic_link"
    // Generate magic link
    logEvent("magic_link.create.start", {
      requestId,
      stage,
      email: emailId,
      appUrlPresent: Boolean(process.env.NEXT_PUBLIC_APP_URL),
      appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() ? "set" : "missing",
    })

    let magicLink: string
    try {
      magicLink = await createMagicLink(normalizedEmail)
    } catch (error) {
      logEvent("magic_link.create.failed", {
        requestId,
        stage,
        email: emailId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim(),
      })
      throw error
    }

    logEvent("magic_link.create.success", {
      requestId,
      stage,
      email: emailId,
      // Don't log the full URL (it can be long and may contain tokens).
      magicLinkLength: magicLink.length,
    })

    stage = "send_magic_link"
    // Send email
    try {
      await sendMagicLink(normalizedEmail, magicLink)
    } catch (emailError) {
      logEvent("magic_link.send.failed", {
        requestId,
        stage,
        email: emailId,
        postmarkTokenSet:
          Boolean(process.env.NEXT_PUBLIC_POSTMARK_SERVER_TOKEN) ||
          Boolean(process.env.NEXT_PUBLIC_POSTMARK_API_KEY),
        error:
          emailError instanceof Error ? emailError.message : String(emailError),
        stack: emailError instanceof Error ? emailError.stack : undefined,
      })
      console.error("Failed to send email:", emailError)
      // Don't expose email service errors to client (prevents enumeration)
      return NextResponse.json(
        { error: "Failed to send email" },
        { status: 500 }
      )
    }

    // Posthog should not turn a successful email send into a 500.
    // If PostHog is misconfigured, we log it and continue.
    stage = "posthog.init"
    let posthog: ReturnType<typeof getPostHogClient> | null = null
    try {
      posthog = getPostHogClient()
      logEvent("posthog.init.success", {
        requestId,
        stage,
        posthogTokenSet: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
      })
    } catch (posthogInitError) {
      logEvent("posthog.init.failed", {
        requestId,
        stage,
        email: emailId,
        error:
          posthogInitError instanceof Error
            ? posthogInitError.message
            : String(posthogInitError),
        stack:
          posthogInitError instanceof Error ? posthogInitError.stack : undefined,
      })
      console.error("Failed to init posthog client:", posthogInitError)
    }

    if (posthog) {
      stage = "posthog.capture"
      try {
        posthog.capture({
          distinctId: normalizedEmail,
          event: "magic_link_sent",
          properties: { email: normalizedEmail },
        })
        logEvent("posthog.capture.queued", {
          requestId,
          stage,
          email: emailId,
        })
      } catch (posthogError) {
        // If posthog is misconfigured, we still want to return success for the user.
        // We keep the endpoint from turning an email-send success into a 500.
        logEvent("posthog.capture.failed", {
          requestId,
          stage,
          email: emailId,
          error:
            posthogError instanceof Error ? posthogError.message : String(posthogError),
          stack:
            posthogError instanceof Error ? posthogError.stack : undefined,
        })
        console.error("Failed to capture posthog event:", posthogError)
      }

      stage = "posthog.shutdown"
      try {
        await posthog.shutdown()
        logEvent("posthog.shutdown.success", { requestId, stage })
      } catch (posthogShutdownError) {
        logEvent("posthog.shutdown.failed", {
          requestId,
          stage,
          email: emailId,
          error:
            posthogShutdownError instanceof Error
              ? posthogShutdownError.message
              : String(posthogShutdownError),
          stack:
            posthogShutdownError instanceof Error
              ? posthogShutdownError.stack
              : undefined,
        })
        console.error(
          "Failed to shutdown posthog client:",
          posthogShutdownError
        )
      }
    }

    // Always return success to prevent email enumeration
    stage = "success"
    logEvent("request.success", {
      requestId,
      stage,
      email: emailId,
      elapsedMs: Date.now() - startedAt,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Login link generation error:", error)
    logEvent("request.failed.unhandled", {
      requestId,
      stage,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      elapsedMs: Date.now() - startedAt,
    })
    return NextResponse.json(
      { error: "An error occurred. Please try again later." },
      { status: 500 }
    )
  }
}
