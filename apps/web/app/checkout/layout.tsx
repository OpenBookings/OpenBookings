import type { Metadata } from "next";

// Every page under /checkout belongs to one guest's booking: never in search
// results. Pages below set their own titles; this only adds the robots rule.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
