"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider } from "posthog-js/react"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, Suspense } from "react"

if (typeof window !== "undefined" && !posthog.__loaded) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: "https://t.openbookings.co",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
    defaults: "2026-01-30",
    capture_pageview: false,
    capture_exceptions: true,
  })
}

function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (pathname) {
      posthog.capture("$pageview", {
        $current_url: window.location.href,
      })
    }
    return () => {
      posthog.capture("$pageleave")
    }
  }, [pathname, searchParams])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  )
}
