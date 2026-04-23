import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkRateLimit, getClientIP } from "@/lib/rateLimit"
import { getPostHogClient } from "@/lib/posthog-server"

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { email } = body as { email?: unknown }

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 })
  }

  const atIndex = email.indexOf("@")
  const isValidEmail =
    email.length <= 254 &&
    atIndex > 0 &&
    atIndex < email.length - 1 &&
    email.indexOf(".", atIndex) > atIndex + 1
  if (!isValidEmail) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 })
  }

  const normalizedEmail = email.toLowerCase().trim()

  const emailRateLimit = checkRateLimit(`email:${normalizedEmail}`, 3, 10 * 60 * 1000)
  if (!emailRateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before requesting another link.", resetTime: emailRateLimit.resetTime },
      { status: 429 }
    )
  }

  const ipRateLimit = checkRateLimit(`ip:${getClientIP(request)}`, 5, 10 * 60 * 1000)
  if (!ipRateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests from this IP. Please try again later.", resetTime: ipRateLimit.resetTime },
      { status: 429 }
    )
  }

  try {
    await auth.api.signInMagicLink({
      headers: request.headers,
      body: {
        email: normalizedEmail,
        callbackURL: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://openbookings.co"}/`,
      },
    })
  } catch (err) {
    console.error("[login-link] signInMagicLink failed:", err)
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 })
  }

  try {
    const posthog = getPostHogClient()
    posthog.capture({
      distinctId: normalizedEmail,
      event: "magic_link_sent",
      properties: { email: normalizedEmail },
    })
    await posthog.shutdown()
  } catch {
    // analytics must not affect response
  }

  return NextResponse.json({ success: true })
}
