import type { Metadata, Viewport } from "next";
import { PostHogProvider } from "@/components/PostHogProvider";
import { CookieBanner } from "@/components/CookieBanner";
import { CookieConsentProvider } from "@/hooks/useCookieConsent";
import { DeviceGate } from "@/components/DeviceGate";
import "./globals.css";

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
    <html lang="en">
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
