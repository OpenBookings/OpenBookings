'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useCookieConsent } from '@/hooks/useCookieConsent'

export function CookieBanner() {
  const { consent, loaded, accept, decline } = useCookieConsent()
  const [isEU, setIsEU] = useState(false)

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    setIsEU(tz.startsWith('Europe/'))
  }, [])

  if (!loaded || !isEU || consent !== null) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm rounded-xl border border-white/10 bg-neutral-900 p-4 shadow-lg">
      <p className="text-sm text-neutral-300">
        We use analytics cookies and session recording to understand how you use
        our service and improve it. You can decline and nothing will be set.{' '}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-white">
          Learn more
        </Link>
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={decline}
          className="flex-1 rounded-lg border border-white/20 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-white/40 hover:text-white"
        >
          Decline
        </button>
        <button
          onClick={accept}
          className="flex-1 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200"
        >
          Accept
        </button>
      </div>
    </div>
  )
}
