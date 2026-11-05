import type { Metadata } from "next";
import { Gloock, Libre_Franklin } from "next/font/google";
import { PostHogProvider, CookieConsentProvider } from "@openbookings/analytics/client";
import { AnalyticsIdentity } from "@/components/AnalyticsIdentity";
import { CookieBanner } from "@/components/CookieBanner";
import { NavigationProgress } from "@/components/NavigationProgress";
import { NAV_HINT_SCRIPT } from "@/lib/nav-hint";
import { consentBannerVersion } from "@openbookings/analytics/consent-events";
import { documentVersionId, getCurrentVersion, getDocument } from "@/lib/legal/documents";
import "./globals.css";

const gloock = Gloock({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-gloock",
});

// globals.css has named Libre Franklin as `--font-sans` all along, but nothing
// ever loaded it, so every `font-sans` surface fell back to ui-sans-serif.
// DESIGN_SYSTEM.md §2.2, bug fix #1.
const libreFranklin = Libre_Franklin({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-libre-franklin",
});

const siteUrl = process.env.NEXT_PUBLIC_WEB_URL || "https://openbookings.co";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "OpenBookings",
  description: "Quick, Easy & Open-Source",
  icons: {
    icon: "/Openbookings-logo-v2.svg",
  },
  openGraph: {
    type: "website",
    siteName: "OpenBookings",
    title: "OpenBookings",
    description: "Quick, Easy & Open-Source",
    url: siteUrl,
    images: [
      {
        url: "/Open-graph-image.png",
        width: 1200,
        height: 630,
        alt: "OpenBookings — Quick, Easy & Open-Source",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenBookings",
    description: "Quick, Easy & Open-Source",
    images: ["/Open-graph-image.png"],
  },
};

// The wording a visitor is shown when they decide about cookies: the banner
// (English only) and the privacy policy version it links to. Stored with every
// consent event.
const privacyPolicy = getDocument("privacy")!;
const BANNER_VERSION = consentBannerVersion(
  documentVersionId("privacy", getCurrentVersion(privacyPolicy).version, "en"),
);

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the nav-hint script sets an attribute and a CSS
    // variable on <html> before React hydrates.
    <html lang="en" className={`dark ${gloock.variable} ${libreFranklin.variable}`} suppressHydrationWarning>
      <head>
        {/* A constant written in lib/nav-hint.ts, with no request or user data
            in it. It has to be a plain inline script: next/script's
            beforeInteractive waits for the JS runtime, which is the delay
            this exists to avoid. */}
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: NAV_HINT_SCRIPT }} />
      </head>
      <body>
        <NavigationProgress />
        <CookieConsentProvider bannerVersion={BANNER_VERSION}>
          <PostHogProvider>
            <AnalyticsIdentity />
            <CookieBanner />
            {children}
          </PostHogProvider>
        </CookieConsentProvider>
      </body>
    </html>
  );
}