"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { auth } from "@/lib/firebase/firebase"
import {
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
} from "firebase/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function VerifyEmailForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsEmail, setNeedsEmail] = useState(false)

  useEffect(() => {
    const verifyLink = async () => {
      try {
        // Get the current URL from the browser
        const url = window.location.href
        
        // Check if this is a valid email link
        const isValidLink = isSignInWithEmailLink(auth, url)

        if (!isValidLink) {
          setError("Invalid or expired sign-in link.")
          setLoading(false)
          return
        }

        // Try to get email from localStorage (same device)
        const storedEmail = window.localStorage.getItem("emailForSignIn")

        if (storedEmail) {
          // Same device - sign in automatically
          await handleSignIn(storedEmail, url)
        } else {
          // Different device - need to prompt for email
          setNeedsEmail(true)
          setLoading(false)
        }
      } catch (err) {
        console.error("Verification error:", err)
        setError(
          err instanceof Error ? err.message : "Failed to verify link."
        )
        setLoading(false)
      }
    }

    verifyLink()
  }, [])

  const handleSignIn = async (userEmail: string, link: string) => {
    setVerifying(true)
    setError(null)

    try {
      const userCredential = await signInWithEmailLink(
        auth,
        userEmail,
        link
      )

      // Clear stored email
      window.localStorage.removeItem("emailForSignIn")

      // Wait for auth state to update
      await new Promise<void>((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
          unsubscribe()
          if (user) {
            resolve()
          } else {
            reject(new Error("Authentication state not updated"))
          }
        })
        
        // Timeout after 5 seconds
        setTimeout(() => {
          unsubscribe()
          reject(new Error("Authentication state update timeout"))
        }, 5000)
      })

      // Get the ID token
      const idToken = await userCredential.user.getIdToken()

      // Call backend to bootstrap user in Firestore
      const response = await fetch("/api/auth/bootstrap-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
      })

      if (!response.ok) {
        console.error("Failed to bootstrap user:", await response.text())
        // Continue anyway - user is authenticated
      }

      // Clear query parameters and redirect to home
      // Use replace to avoid adding to history and prevent redirect loops
      router.replace("/")
    } catch (err: any) {
      console.error("Sign-in error:", err)
      if (err.code === "auth/invalid-action-code") {
        setError("This link has expired or already been used.")
      } else if (err.code === "auth/invalid-email") {
        setError("Invalid email address.")
      } else {
        setError(
          err.message || "Failed to sign in. Please request a new link."
        )
      }
      setVerifying(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const url = window.location.href
    await handleSignIn(email, url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-4"></div>
          <p className="text-muted-foreground">Verifying your link...</p>
        </div>
      </div>
    )
  }

  if (error && !needsEmail) {
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

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Complete sign in</h1>
          <p className="text-muted-foreground">
            {needsEmail
              ? "Please enter your email address to complete sign in."
              : "Signing you in..."}
          </p>
        </div>

        {needsEmail && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium mb-2"
              >
                Email address
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={verifying}
                autoComplete="email"
                autoFocus
              />
            </div>

            {error && (
              <div className="p-3 rounded-md bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            <Button type="submit" disabled={verifying} className="w-full">
              {verifying ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        )}

        {verifying && !needsEmail && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-4"></div>
            <p className="text-muted-foreground">Signing you in...</p>
          </div>
        )}
      </div>
    </div>
  )
}
