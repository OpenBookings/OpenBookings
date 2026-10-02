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
import { useState, useEffect, useRef, useContext, useCallback, createContext, createElement, Suspense } from 'react'
import { CONSENT_TTL_MS, adoptExpiry, loadConsent, newConsentUuid, saveConsent, type ConsentState } from './consent-device'
import { CONSENT_VERSION, consentEventType, type ConsentEvent } from './consent-events'
import { enqueueConsentEvent, flushConsentOutbox, type FlushResult, type OutboxDeps } from './consent-outbox'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const RELEASE_SHA = process.env.NEXT_PUBLIC_RELEASE_SHA

// ─── Cookie Consent ───────────────────────────────────────────────────────────

interface CookieConsentContextValue {
  consent: ConsentState
  loaded: boolean
  /** True while a visitor who already chose has reopened the banner. */
  reviewing: boolean
  accept: () => void
  decline: () => void
  /** Show the banner again so an earlier choice can be changed. */
  reopen: () => void
  /** Record, once per device and account, whose decision this is. */
  link: (userId: string) => void
}

export { CONSENT_VERSION }

const CONSENT_ENDPOINT = '/api/consent'
const LINKED_KEY = 'ob_consent_linked'

export const CookieConsentContext = createContext<CookieConsentContextValue>({
  consent: null,
  loaded: false,
  reviewing: false,
  accept: () => {},
  decline: () => {},
  reopen: () => {},
  link: () => {},
})

/**
 * Stop PostHog and remove what it stored. Used when consent is withdrawn:
 * "declined" has to mean nothing analytics-related is left on the device,
 * including PostHog's own opt-out marker, so a later Accept starts clean.
 */
function stopAnalytics() {
  try {
    if (posthog.__loaded) posthog.opt_out_capturing()
  } catch {
    // Not initialised or already torn down.
  }
  try {
    const mine = (name: string) => name.startsWith('ph_') || name.startsWith('__ph_opt_in_out_')
    for (const key of Object.keys(localStorage)) if (mine(key)) localStorage.removeItem(key)
    const host = window.location.hostname
    const parent = host.split('.').slice(-2).join('.')
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0]!.trim()
      if (!mine(name)) continue
      for (const domain of ['', `; domain=${host}`, `; domain=.${parent}`]) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain}`
      }
    }
  } catch {
    // Storage unavailable: nothing was stored to remove.
  }
}

function outboxDeps(): OutboxDeps {
  return {
    storage: localStorage,
    fetch: (input, init) => fetch(input, init),
    endpoint: CONSENT_ENDPOINT,
    // A rejected event can never succeed; say so where error tracking sees it.
    onDrop: (event, status) =>
      console.error(`[consent] ${event.eventType} event rejected with ${status}; dropped`),
  }
}

/**
 * Owns the visitor's cookie decision.
 *
 * The device record decides whether analytics runs. Every decision is also
 * sent to the server as evidence, through an outbox: the choice takes effect
 * immediately and the network catches up when it can.
 *
 * `bannerVersion` names the wording the visitor was shown, e.g.
 * `1.1+privacy@2026-10-03/en`; it is stored with each event.
 */
export function CookieConsentProvider({
  children,
  bannerVersion = CONSENT_VERSION,
}: {
  children: React.ReactNode
  bannerVersion?: string
}) {
  const [consent, setConsent] = useState<ConsentState>(null)
  const [loaded, setLoaded] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const cidRef = useRef<string | null>(null)
  const consentRef = useRef<ConsentState>(null)

  /** Deliver what is queued. Never throws: evidence can be lost, the page cannot. */
  const flush = useCallback(async (): Promise<FlushResult> => {
    try {
      return await flushConsentOutbox(outboxDeps())
    } catch {
      // localStorage itself can be unreachable.
      return { expiries: {}, remaining: 0 }
    }
  }, [])

  /** Queue one event; returns its idempotency key, or null if it could not be queued. */
  const send = useCallback(
    (eventType: ConsentEvent['eventType'], analytics: boolean): string | null => {
      const cid = cidRef.current
      if (!cid) return null
      try {
        const idempotencyKey = newConsentUuid()
        enqueueConsentEvent(outboxDeps(), {
          consentId: cid,
          eventType,
          categories: { analytics },
          bannerVersion,
          idempotencyKey,
        })
        return idempotencyKey
      } catch {
        return null
      }
    },
    [bannerVersion],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let result: Awaited<ReturnType<typeof loadConsent>> = { consent: null, cid: null, backfill: false }
      try {
        result = await loadConsent(localStorage, CONSENT_VERSION)
      } catch {
        // No storage: treated as no decision yet.
      }
      if (cancelled) return
      cidRef.current = result.cid
      consentRef.current = result.consent
      if (result.consent) setConsent(result.consent)
      setLoaded(true)
      // A choice made before the consent log existed: record it once, as it stands.
      if (result.backfill && result.consent) {
        send(result.consent === 'accepted' ? 'granted' : 'denied', result.consent === 'accepted')
      }
      void flush()
    })()

    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
    }
  }, [flush, send])

  const decide = useCallback(
    (next: Exclude<ConsentState, null>) => {
      const previous = consentRef.current
      const eventType = consentEventType(next, previous)
      consentRef.current = next

      // Device first: the choice must hold even if nothing below succeeds.
      setConsent(next)
      setReviewing(false)
      // A withdrawal stops analytics now, not after the network has answered.
      if (eventType === 'withdrawn') stopAnalytics()

      void (async () => {
        try {
          cidRef.current ??= newConsentUuid()
          await saveConsent(localStorage, {
            consent: next,
            version: CONSENT_VERSION,
            cid: cidRef.current,
            expiresAt: Date.now() + CONSENT_TTL_MS,
          })
        } catch {
          // See flush.
        }
        const key = send(eventType, next === 'accepted')

        if (eventType === 'withdrawn') {
          // Give delivery a moment (the request is keepalive, so it survives
          // the reload anyway), then reload so nothing initialised under the
          // old consent is still running.
          await Promise.race([flush(), new Promise((resolve) => setTimeout(resolve, 1500))])
          window.location.reload()
          return
        }

        // Take the server's expiry for this decision only, so device and log
        // agree. Events from other tabs or sign-in links never extend it.
        const { expiries } = await flush()
        const expiresAt = key ? expiries[key] : undefined
        const cid = cidRef.current
        if (expiresAt && cid) {
          try {
            await adoptExpiry(localStorage, { consent: next, cid, expiresAt: Date.parse(expiresAt) })
          } catch {
            // See flush.
          }
        }
      })()
    },
    [flush, send],
  )

  const accept = useCallback(() => decide('accepted'), [decide])
  const decline = useCallback(() => decide('declined'), [decide])
  const reopen = useCallback(() => setReviewing(true), [])

  const link = useCallback(
    (userId: string) => {
      const cid = cidRef.current
      const current = consentRef.current
      if (!cid || !current) return
      const pair = `${cid}:${userId}`
      try {
        if (localStorage.getItem(LINKED_KEY) === pair) return
        localStorage.setItem(LINKED_KEY, pair)
      } catch {
        return
      }
      send('linked', current === 'accepted')
      void flush()
    },
    [flush, send],
  )

  return createElement(
    CookieConsentContext.Provider,
    { value: { consent, loaded, reviewing, accept, decline, reopen, link } },
    children,
  )
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
    // Belt for stopAnalytics(): if an opt-out marker survived a withdrawal,
    // an explicit Accept must still turn capturing back on.
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing()
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
  const { loaded, consent, link } = useCookieConsent()

  // Consent evidence is linked to the account whether analytics was accepted
  // or declined: a refusal is as much the account holder's decision as an
  // acceptance. This is separate from PostHog identity below, which only
  // exists when analytics is on.
  useEffect(() => {
    if (loaded && consent && userId) link(userId)
  }, [loaded, consent, userId, link])

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
