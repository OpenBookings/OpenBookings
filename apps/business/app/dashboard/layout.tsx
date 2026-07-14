import { auth } from "@/lib/auth";
import { queryOne } from "@openbookings/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/sidebar-02/app-sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const row = await queryOne<{ onboarding_completed_at: string | null }>(
    `SELECT onboarding_completed_at FROM host_onboarding WHERE user_id = $1`,
    [session.user.id]
  );
  if (!row?.onboarding_completed_at) redirect("/onboarding");

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <DashboardSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
