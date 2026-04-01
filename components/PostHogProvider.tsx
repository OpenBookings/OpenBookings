"use client"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider } from "posthog-js/react"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, Suspense } from "react"

type CookieYesCategories = {
  necessary?: boolean
  functional?: boolean
  analytics?: boolean
  performance?: boolean
  advertisement?: boolean
}

type CookieYesConsent = {
  categories?: CookieYesCategories
}

type CookieYesConsentUpdateDetail = {
  accepted: string[]
  rejected: string[]
}

declare global {
  interface Window {
    getCkyConsent?: () => CookieYesConsent
  }
}

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

if (typeof window !== "undefined" && POSTHOG_KEY && !posthog.__loaded) {
  posthog.init(POSTHOG_KEY, {
    api_host: "https://t.openbookings.co",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
    defaults: "2026-01-30",
    capture_pageview: false,
    capture_exceptions: true,
    opt_out_capturing_by_default: true,
  })
}

function syncPostHogFromCookieYesApi() {
  if (typeof window.getCkyConsent !== "function") return
  try {
    const consent = window.getCkyConsent()
    if (consent?.categories?.analytics) {
      posthog.opt_in_capturing()
    } else {
      posthog.opt_out_capturing()
    }
  } catch {
    // Banner disabled or API not ready
  }
}

function setPostHogFromAcceptedCategories(accepted: string[]) {
  if (accepted.includes("analytics")) {
    posthog.opt_in_capturing()
  } else {
    posthog.opt_out_capturing()
  }
}

function CookieYesPostHogBridge() {
  useEffect(() => {
    const onBannerLoaded = () => syncPostHogFromCookieYesApi()

    const onConsentUpdate = (e: Event) => {
      const detail = (e as CustomEvent<CookieYesConsentUpdateDetail>).detail
      if (!detail?.accepted) return
      setPostHogFromAcceptedCategories(detail.accepted)
    }

    document.addEventListener("cookieyes_banner_loaded", onBannerLoaded)
    document.addEventListener("cookieyes_consent_update", onConsentUpdate)

    // Sync immediately for returning visitors (getCkyConsent already available)
    syncPostHogFromCookieYesApi()

    // Safety net: if cookieyes_banner_loaded fired before this effect mounted
    // (possible on cached/fast loads) and getCkyConsent wasn't ready yet above,
    // retry once the script has had time to fully initialize.
    const timer = setTimeout(syncPostHogFromCookieYesApi, 500)

    return () => {
      document.removeEventListener("cookieyes_banner_loaded", onBannerLoaded)
      document.removeEventListener("cookieyes_consent_update", onConsentUpdate)
      clearTimeout(timer)
    }
  }, [])

  return null
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
      <CookieYesPostHogBridge />
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  )
}
