import type { Metadata } from "next";
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
      <head>
        <script id="Cookiebot" src="https://consent.cookiebot.com/uc.js" data-cbid="cea90d99-6fb6-4db4-9820-9c25fd17ba0a" data-blockingmode="auto" type="text/javascript"></script>
      </head>
      <body>
      <script id="cookieyes" type="text/javascript" src="https://cdn-cookieyes.com/client_data/b30e1d3caf278cdefa0819752c00f4f4/script.js"></script>
        {children}
      </body>
    </html>
  );
}