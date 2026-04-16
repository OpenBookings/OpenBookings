'use client'

import { useState, useEffect, useContext, createContext, createElement } from 'react'

type ConsentState = 'accepted' | 'declined' | null

interface CookieConsentContextValue {
  consent: ConsentState
  accept: () => void
  decline: () => void
}

const STORAGE_KEY = 'ob_cookie_consent'

export const CookieConsentContext = createContext<CookieConsentContextValue>({
  consent: null,
  accept: () => {},
  decline: () => {},
})

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentState>(null)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    console.log('[CookieConsent] Loaded stored consent state:', stored)
    if (stored === 'accepted' || stored === 'declined') {
      setConsent(stored)
    }
  }, [])

  function accept() {
    localStorage.setItem(STORAGE_KEY, 'accepted')
    setConsent('accepted')
  }

  function decline() {
    localStorage.setItem(STORAGE_KEY, 'declined')
    setConsent('declined')
  }

  return createElement(CookieConsentContext.Provider, { value: { consent, accept, decline } }, children)
}

export function useCookieConsent() {
  return useContext(CookieConsentContext)
}
