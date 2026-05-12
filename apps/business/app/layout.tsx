import type { Metadata, Viewport } from "next";
import { Gloock, Allura, Libre_Franklin } from "next/font/google";
import { PostHogProvider, CookieConsentProvider } from "@openbookings/analytics/client";
import { CookieBanner } from "@/components/CookieBanner";
import { DeviceGate } from "@/components/DeviceGate";
import "./globals.css";

const libreFranklin = Libre_Franklin({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const gloock = Gloock({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-gloock",
  display: "swap",
});

const allura = Allura({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-allura",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "OpenBookings Business",
  description: "Manage your properties on OpenBookings",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${libreFranklin.variable} ${gloock.variable}`}>
      <head />
      <body>
        <CookieConsentProvider>
          <PostHogProvider>
            <DeviceGate />
            <CookieBanner />
            {children}
          </PostHogProvider>
        </CookieConsentProvider>
      </body>
    </html>
  );
}
