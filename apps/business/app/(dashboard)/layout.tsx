import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/sidebar-02/app-sidebar";
import { SessionEntryOverlay } from "@/components/SessionEntryOverlay";
import { PasskeyNudge } from "@/components/dashboard/passkey-nudge";

// Auth + onboarding gating happens in proxy.ts before this ever renders.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <DashboardSidebar />
      <SidebarInset>
        <PasskeyNudge />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
