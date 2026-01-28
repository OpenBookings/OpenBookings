import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenBookings",
  description: "Quick, Easy & Open-Source",
  icons: {
    icon: "/Openbookings-logo-v2.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
        <Script
          id="cookieyes"
          src="https://cdn-cookieyes.com/client_data/b30e1d3caf278cdefa0819752c00f4f4/script.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}