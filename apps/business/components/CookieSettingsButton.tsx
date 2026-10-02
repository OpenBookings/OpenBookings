'use client'

import { useCookieConsent } from '@openbookings/analytics/client'

/** Reopens the cookie banner so an earlier choice can be changed or withdrawn. */
export function CookieSettingsButton({ className }: { className?: string }) {
  const { reopen } = useCookieConsent()
  return (
    <button type="button" onClick={reopen} className={className}>
      Cookie settings
    </button>
  )
}
