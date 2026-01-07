import type { Metadata } from "next";
import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenBookings",
  description: "Quick, Easy & Open-Source",
  icons: {
    icon: "/Openbookings-logo.svg",
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
        <Auth0Provider>
          {children}
        </Auth0Provider>
      </body>
    </html>
  );
}
