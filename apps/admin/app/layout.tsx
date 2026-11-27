import type { Metadata } from "next";
import Link from "next/link";
import { adminDbLabel } from "@/lib/db";
import { databaseHost, isStripeTestMode } from "@/lib/super-admin";
import { requireStaff } from "@/lib/staff";
import "./globals.css";

export const metadata: Metadata = { title: "OpenBookings admin" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <div className="bg-red-600 px-4 py-1 text-center text-sm font-medium text-white">
          {`Super admin — dev only — connected to ${adminDbLabel(databaseHost)} — ${
            isStripeTestMode() ? "Stripe: test mode" : "Stripe: NOT test mode — real actions disabled"
          }`}
        </div>
        <header className="flex gap-4 border-b px-4 py-3">
          <Link href="/" className="font-medium">
            Bookings
          </Link>
          <Link href="/invoices" className="font-medium">
            Invoices
          </Link>
          <Link href="/flagged-payments" className="font-medium">
            Flagged payments
          </Link>
        </header>
        <main className="p-4">{children}</main>
      </body>
    </html>
  );
}
