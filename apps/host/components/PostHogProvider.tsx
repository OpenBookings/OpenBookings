'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, Suspense } from 'react'
import { useCookieConsent } from '@/hooks/useCookieConsent'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    posthog.capture('$pageview', { $current_url: window.location.href })
    return () => {
      posthog.capture('$pageleave')
    }
  }, [pathname, searchParams])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const { consent } = useCookieConsent()
  const [initialized, setInitialized] = useState(false)
  const initRef = useRef(false)

  useEffect(() => {
    if (consent !== 'accepted' || initRef.current || !POSTHOG_KEY) return
    initRef.current = true
    posthog.init(POSTHOG_KEY, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
      ui_host: 'https://eu.posthog.com',
      opt_in_site_apps: true,
      autocapture: false,
      capture_pageview: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
      },
    })
    setInitialized(true)
  }, [consent])

  if (!initialized) {
    return <>{children}</>
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  )
}
