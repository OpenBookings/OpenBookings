"use client";

import { authClient } from "@/lib/auth-client";
import { usePostHog } from "@openbookings/analytics/client";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function UserProfile() {
  const { data: session } = authClient.useSession();
  const posthog = usePostHog();
  const router = useRouter();

  const name = session?.user?.name ?? "";
  const firstname = name.split(" ")[0] || "";
  const email = session?.user?.email ?? "";

  async function handleLogout() {
    // Drop the verified PostHog Support identity so it doesn't carry over to
    // the next user on a shared browser.
    posthog?.clearIdentity?.();
    await authClient.signOut();
    router.push("/");
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex items-center gap-3 px-2 py-2 transition-[gap,padding] duration-300 ease-in-out group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0">
          <img
            src={
              name
                ? `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(firstname)}`
                : "https://api.dicebear.com/9.x/open-peeps/svg"
            }
            alt="avatar"
            className="size-8 shrink-0 rounded-full object-cover"
          />
          <div className="flex flex-1 flex-col min-w-0 overflow-hidden text-left text-sm leading-tight whitespace-nowrap transition-[opacity,width] duration-300 ease-in-out group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:opacity-0">
            <span className="truncate font-medium">{name || "—"}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            title="Log out"
            aria-label="Log out"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
