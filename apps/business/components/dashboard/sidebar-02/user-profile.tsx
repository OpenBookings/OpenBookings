"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import {
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function UserProfile() {
  const { data: session } = authClient.useSession();
  const router = useRouter();

  const name = session?.user?.name ?? "";
  const firstname = name.split(" ")[0] || "";
  const email = session?.user?.email ?? "";

  async function handleLogout() {
    await authClient.signOut();
    router.push("/");
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex items-center gap-3 px-2 py-2">
          <img
            src={
              name
                ? `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(firstname)}`
                : "https://api.dicebear.com/9.x/open-peeps/svg"
            }
            alt="avatar"
            className="size-8 shrink-0 rounded-full object-cover"
          />
          <div className="flex flex-col flex-1 min-w-0 text-left text-sm leading-tight">
            <span className="truncate font-medium">{name || "—"}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </div>
        </div>
        <SidebarMenuButton onClick={handleLogout} className="mt-1 w-full">
          <LogOut className="size-4" />
          <span>Log out</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
