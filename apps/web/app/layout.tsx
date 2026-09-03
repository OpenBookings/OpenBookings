import type { Metadata } from "next";
import { Gloock, Libre_Franklin } from "next/font/google";
import { PostHogProvider, CookieConsentProvider } from "@openbookings/analytics/client";
import { CookieBanner } from "@/components/CookieBanner";
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

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://openbookings.co";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${gloock.variable} ${libreFranklin.variable}`}>
      <head />
      <body>
        <CookieConsentProvider>
          <PostHogProvider>
            <CookieBanner />
            {children}
          </PostHogProvider>
        </CookieConsentProvider>
      </body>
    </html>
  );
}