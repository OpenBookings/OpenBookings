import type { Metadata } from "next";
import Link from "next/link";
import { readPool } from "@/lib/db";
import { loadModerationCounts } from "@/lib/moderation";
import { requireStaff } from "@/lib/staff";
import "./globals.css";

export const metadata: Metadata = { title: "OpenBookings admin" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const live = process.env.NODE_ENV === "production";
  // The header shows how many reviews and replies wait for a person; a failed count never takes the console down.
  const held = await loadModerationCounts(readPool()).then(
    (counts) => counts.held,
    (error) => {
      console.error("[admin] could not count held reviews", error);
      return null;
    },
  );
  return (
    <html lang="en">
      <body className="font-sans antialiased">
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
          <Link href="/reviews" className="flex items-center gap-1.5 font-medium">
            Reviews
            {held ? (
              <span className="rounded-full bg-foreground px-1.5 text-xs text-background" aria-label={`${held} held`}>
                {held}
              </span>
            ) : null}
          </Link>
          <span
            className={`ml-auto rounded px-2 py-0.5 text-xs font-semibold uppercase ${
              live ? "bg-red-600 text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            {live ? "Production" : "Development"}
          </span>
          <span className="text-sm text-muted-foreground">{staff.email}</span>
          <Link href="/audit" className="font-medium">
            Audit
          </Link>
          <Link href="/security" className="font-medium">
            Security
          </Link>
        </header>
        <main className="p-4">{children}</main>
      </body>
    </html>
  );
}
