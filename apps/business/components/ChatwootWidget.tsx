'use client'

import Script from 'next/script'

declare global {
  interface Window {
    chatwootSettings?: Record<string, unknown>
    chatwootSDK?: { run: (options: { websiteToken: string; baseUrl: string }) => void }
  }
}

const baseUrl = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL
const websiteToken = process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN

export function ChatwootWidget() {
  if (!baseUrl || !websiteToken) return null

  return (
    <Script
      id="chatwoot-sdk"
      src={`${baseUrl}/packs/js/sdk.js`}
      strategy="afterInteractive"
      onLoad={() => {
        window.chatwootSettings = {
          position: 'right',
          type: 'standard',
          launcherTitle: '',
        }
        window.chatwootSDK?.run({ websiteToken, baseUrl })
      }}
    />
  )
}
