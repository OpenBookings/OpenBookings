import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/sidebar-08/app-sidebar";
import { SessionEntryOverlay } from "@/components/SessionEntryOverlay";
import { PasskeyNudge } from "@/components/dashboard/passkey-nudge";
import { SupportPanel } from "@/components/support/support-panel";
import { SupportProvider } from "@/components/support/support-provider";
import { Toaster } from "@/components/ui/sonner";
import { getServerSession } from "@/lib/auth";
import { loadPropertyBrand } from "@/lib/property-brand";
import { loadSupportBootstrap } from "@/lib/support/server/bootstrap";
import { countReviewsNeedingReply } from "@/lib/reviews/query";

// Auth + onboarding gating happens in proxy.ts before this ever renders, so
// there is no redirect here — a null session simply means no property brand
// and the sidebar keeps its default OpenBookings header.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  const [brand, support, reviewsWaiting] = await Promise.all([
    loadPropertyBrand(session),
    // Null unless SUPPORT_CHAT_ENABLED and the session has a verified org.
    loadSupportBootstrap(),
    session?.user.account_type === "business" ? countReviewsNeedingReply(session) : Promise.resolve(0),
  ]);

  const shell = (
    <>
      <SessionEntryOverlay />
      <DashboardSidebar brand={brand} reviewsWaiting={reviewsWaiting} />
      <SidebarInset>
        <PasskeyNudge />
        {children}
      </SidebarInset>
      {/* Mounted here, not per page, so a chat survives navigation. */}
      {support ? <SupportPanel /> : null}
      <Toaster />
    </>
  );

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      {support ? <SupportProvider bootstrap={support}>{shell}</SupportProvider> : shell}
    </SidebarProvider>
  );
}
