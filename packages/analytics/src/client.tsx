'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'

export { usePostHog } from 'posthog-js/react'
export type {
  Ticket,
  TicketStatus,
  Message,
  GetTicketsResponse,
  GetMessagesResponse,
  SendMessageResponse,
} from 'posthog-js'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef, useContext, createContext, createElement, Suspense } from 'react'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const RELEASE_SHA = process.env.NEXT_PUBLIC_RELEASE_SHA

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

// Whether posthog.init() has actually run. Init is gated on consent and happens
// in an effect, and child effects run before the parent's -- so anything that
// needs a live client has to wait on this rather than read posthog.__loaded once.
const PostHogReadyContext = createContext(false)

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
      // Opt into PostHog's dated config defaults ("auto-upgrade"). The SDK derives
      // its current best-practice configuration for this snapshot; explicit options
      // below still override it. Bump the date deliberately to adopt newer defaults.
      defaults: '2026-08-29',
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      ui_host: 'https://t.openbookings.co',
      autocapture: false,
      // Keep manual pageview capture via <PostHogPageView>; the dated defaults would
      // otherwise switch this to automatic 'history=_change' capture.
      capture_pageview: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
      },
    })
    // Tag every event with the image it came from, so a spike can be pinned to
    // a release. Registered rather than passed per-capture: this is a super
    // property, so it rides along on $pageview and everything downstream too.
    // Only apps whose Dockerfile passes the build arg have it -- the rest would
    // otherwise register `undefined` and put a useless key on every event.
    if (RELEASE_SHA) {
      posthog.register({ release: RELEASE_SHA })
    }
    setInitialized(true)
  }, [consent])

  if (!initialized) {
    return <PostHogReadyContext.Provider value={false}>{children}</PostHogReadyContext.Provider>
  }

  return (
    <PostHogReadyContext.Provider value={true}>
      <PHProvider client={posthog}>
        <Suspense fallback={null}>
          <PostHogPageView />
        </Suspense>
        {children}
      </PHProvider>
    </PostHogReadyContext.Provider>
  )
}

// ─── Identity ─────────────────────────────────────────────────────────────────

/**
 * Links captured events to the signed-in account.
 *
 * Pass the user's UUID and nothing else. PostHog is a third-party processor and
 * the privacy policy promises it never receives a name, email, or full IP; the
 * UUID is a pseudonym only our own database can resolve back to a person. If a
 * person property is ever worth adding, the policy's §2.3 and §5 have to say so
 * first.
 *
 * Identity follows consent. With analytics declined PostHog is never
 * initialised, so this is a no-op and a signed-in visitor stays untracked.
 *
 * Mount once per app, inside <PostHogProvider>. It covers a fresh sign-in (the
 * session appears mid-visit) and a restored one (the cookie was already there
 * on first paint) with the same code path -- both are just `userId` arriving.
 */
export function useAnalyticsIdentity(userId: string | null | undefined) {
  const ready = useContext(PostHogReadyContext)
  const identifiedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!ready) return

    if (userId) {
      // identify() reloads feature flags, so don't re-send an identity we
      // already sent -- useSession() hands us a new object on every poll.
      if (identifiedRef.current === userId) return
      identifiedRef.current = userId
      posthog.identify(userId)
      return
    }

    // Signed out: by the button, by expiry, or revoked from another device.
    // Only reset an identity this hook actually set -- a bare reset would throw
    // away the anonymous distinct_id of every visitor who was never signed in.
    if (identifiedRef.current !== null) {
      identifiedRef.current = null
      posthog.reset()
    }
  }, [ready, userId])
}
