'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef, useContext, createContext, createElement, Suspense } from 'react'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

// ─── Cookie Consent ───────────────────────────────────────────────────────────

type ConsentState = 'accepted' | 'declined' | null

interface ConsentRecord {
  v: ConsentState
  exp: number
  h: string
  ver: string
}

interface CookieConsentContextValue {
  consent: ConsentState
  loaded: boolean
  accept: () => void
  decline: () => void
}

const STORAGE_KEY = 'ob_cookie_consent'
const CONSENT_TTL_MS = 90 * 24 * 60 * 60 * 1000
// Client-side salt — deters naive localStorage edits, not a secret
const SALT = 'ob-consent-v1'
// Bump this when cookie policy changes to force re-consent.
// In client components, only NEXT_PUBLIC_ env vars are available.
export const CONSENT_VERSION = process.env.NEXT_PUBLIC_COOKIE_VERSION ?? '1'

async function hashRecord(v: ConsentState, exp: number): Promise<string> {
  const data = new TextEncoder().encode(`${v}:${exp}:${SALT}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function writeConsent(v: ConsentState): Promise<void> {
  const exp = Date.now() + CONSENT_TTL_MS
  const h = await hashRecord(v, exp)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ v, exp, h, ver: CONSENT_VERSION } satisfies ConsentRecord))
}

async function readConsent(): Promise<ConsentState> {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const record: ConsentRecord = JSON.parse(raw)
    if (record.ver !== CONSENT_VERSION) return null
    if (record.v !== 'accepted' && record.v !== 'declined') return null
    if (typeof record.exp !== 'number' || Date.now() > record.exp) return null
    const expected = await hashRecord(record.v, record.exp)
    if (expected !== record.h) return null
    return record.v
  } catch {
    return null
  }
}

export const CookieConsentContext = createContext<CookieConsentContextValue>({
  consent: null,
  loaded: false,
  accept: () => {},
  decline: () => {},
})

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentState>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    readConsent().then(v => {
      if (v) setConsent(v)
      setLoaded(true)
    })
  }, [])

  function accept() {
    setConsent('accepted')
    writeConsent('accepted')
  }

  function decline() {
    setConsent('declined')
    writeConsent('declined')
  }

  return createElement(CookieConsentContext.Provider, { value: { consent, loaded, accept, decline } }, children)
}

export function useCookieConsent() {
  return useContext(CookieConsentContext)
}

// ─── PostHog Provider ─────────────────────────────────────────────────────────

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
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      ui_host: 'https://eu.posthog.com',
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
