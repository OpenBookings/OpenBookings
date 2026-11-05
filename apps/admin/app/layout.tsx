import type { Metadata } from "next";
import Link from "next/link";
import { databaseHost, isStripeTestMode, requireSuperAdmin } from "@/lib/super-admin";
import "./globals.css";

export const metadata: Metadata = { title: "OpenBookings admin" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  requireSuperAdmin();
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <div className="bg-red-600 px-4 py-1 text-center text-sm font-medium text-white">
          {`Super admin — dev only — connected to ${databaseHost(process.env.DATABASE_URL)} — ${
            isStripeTestMode() ? "Stripe: test mode" : "Stripe: NOT test mode — real actions disabled"
          }`}
        </div>
        <header className="border-b px-4 py-3">
          <Link href="/" className="font-medium">
            Bookings
          </Link>
        </header>
        <main className="p-4">{children}</main>
      </body>
    </html>
  );
}
