import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { PostHogProvider } from "@/components/PostHogProvider";
import { CookieBanner } from "@/components/CookieBanner";
import { CookieConsentProvider } from "@/hooks/useCookieConsent";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "OpenBookings Host",
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
    <html lang="en" className={inter.variable}>
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
