import type { Metadata } from "next";

// Every page under /bookings belongs to one guest's booking: never in search
// results. Pages below set their own titles; this only adds the robots rule.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function BookingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
