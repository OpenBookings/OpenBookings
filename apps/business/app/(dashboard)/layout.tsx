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

// Auth + onboarding gating happens in proxy.ts before this ever renders, so
// there is no redirect here — a null session simply means no property brand
// and the sidebar keeps its default OpenBookings header.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [brand, support] = await Promise.all([
    getServerSession().then(loadPropertyBrand),
    // Null unless SUPPORT_CHAT_ENABLED and the session has a verified org.
    loadSupportBootstrap(),
  ]);

  const shell = (
    <>
      <SessionEntryOverlay />
      <DashboardSidebar brand={brand} />
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
