import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/sidebar-08/app-sidebar";
import { SessionEntryOverlay } from "@/components/SessionEntryOverlay";
import { CurrentPropertyWatch } from "@/components/dashboard/current-property-watch";
import { PasskeyNudge } from "@/components/dashboard/passkey-nudge";
import { SupportPanel } from "@/components/support/support-panel";
import { SupportProvider } from "@/components/support/support-provider";
import { Toaster } from "@/components/ui/sonner";
import { getServerSession } from "@/lib/auth";
import { getCurrentProperty, getSwitchableProperties } from "@/lib/current-property";
import { accessLevels } from "@/lib/page-access";
import { loadSupportBootstrap } from "@/lib/support/server/bootstrap";
import { countReviewsNeedingReply } from "@/lib/reviews/query";

// Auth + onboarding gating happens in proxy.ts before this ever renders, so
// there is no redirect here — a null session simply means no current hotel
// and the sidebar keeps its plain OpenBookings header.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, current, properties] = await Promise.all([
    getServerSession(),
    getCurrentProperty(),
    getSwitchableProperties(),
  ]);
  const propertyId = current?.propertyId ?? null;
  const [support, reviewsWaiting] = await Promise.all([
    // Null unless SUPPORT_CHAT_ENABLED and the session has a verified org.
    loadSupportBootstrap(),
    session?.user.account_type === "business" ? countReviewsNeedingReply(session, propertyId) : Promise.resolve(0),
  ]);

  const shell = (
    <>
      <SessionEntryOverlay />
      <DashboardSidebar
        properties={properties}
        current={current}
        access={accessLevels(current)}
        reviewsWaiting={reviewsWaiting}
      />
      <SidebarInset>
        <CurrentPropertyWatch renderedPropertyId={propertyId} />
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
