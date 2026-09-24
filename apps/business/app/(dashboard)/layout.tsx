import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/sidebar-08/app-sidebar";
import { SessionEntryOverlay } from "@/components/SessionEntryOverlay";
import { PasskeyNudge } from "@/components/dashboard/passkey-nudge";
import { Toaster } from "@/components/ui/sonner";
import { getServerSession } from "@/lib/auth";
import { loadPropertyBrand } from "@/lib/property-brand";

// Auth + onboarding gating happens in proxy.ts before this ever renders, so
// there is no redirect here — a null session simply means no property brand
// and the sidebar keeps its default OpenBookings header.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const brand = await loadPropertyBrand(await getServerSession());

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <SessionEntryOverlay />
      <DashboardSidebar brand={brand} />
      <SidebarInset>
        <PasskeyNudge />
        {children}
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}
