"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"

/**
 * Landing page after a magic link is clicked.
 * Better Auth verifies the token at /api/auth/magic-link/verify and redirects here.
 * Any error is passed via the `error` search param.
 */
export const dynamic = "force-dynamic"

function VerifyPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const errorParam = searchParams.get("error")
    if (errorParam) {
      switch (errorParam) {
        case "invalid_token":
        case "expired_token":
          setError("This link has expired or already been used. Please request a new one.")
          break
        default:
          setError("Sign-in failed. Please request a new magic link.")
      }
    } else {
      // No error — Better Auth already set the session cookie and redirected here.
      // Push to home so the session state is reflected.
      router.replace("/")
    }
  }, [searchParams, router])

  if (!error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-4"></div>
          <p className="text-muted-foreground">Signing you in...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-red-600 dark:text-red-400">
          <svg
            className="mx-auto h-12 w-12 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="font-medium">{error}</p>
        </div>
        <Button onClick={() => router.push("/")} variant="outline">
          Go to home
        </Button>
      </div>
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-4"></div>
            <p className="text-muted-foreground">Signing you in...</p>
          </div>
        </div>
      }
    >
      <VerifyPageContent />
    </Suspense>
  )
}
