"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { MessagesList } from "@/components/dashboard/messages/messages-list";
import { ThreadView } from "@/components/dashboard/messages/thread-view";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ThreadListItem } from "@openbookings/messaging/client";

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeToDesktopQuery(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function useIsDesktop() {
  return React.useSyncExternalStore(
    subscribeToDesktopQuery,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

export function MessagesView({
  threads,
  currentUserId,
}: {
  threads: ThreadListItem[];
  currentUserId: string;
}) {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Selection lives in the URL: /dashboard/bookings/messages?id=<threadId>
  const selectedId = searchParams.get("id");
  const selected = threads.find((t) => t.id === selectedId) ?? null;

  const select = (id: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (id === null) {
      params.delete("id");
    } else {
      params.set("id", id);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const handleSelect = (thread: ThreadListItem) => {
    select(selectedId === thread.id ? null : thread.id);
  };
  const handleClose = () => select(null);

  return (
    <>
      <div className="flex items-stretch lg:h-[calc(100svh-var(--header-height)-3rem)] lg:pr-6">
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border lg:max-w-sm lg:overflow-y-auto">
          <MessagesList threads={threads} selectedId={selectedId} onSelect={handleSelect} />
        </div>
        <div className="hidden flex-1 lg:ml-4 lg:flex lg:flex-col">
          {selected ? (
            <ThreadView key={selected.id} thread={selected} currentUserId={currentUserId} onClose={handleClose} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border p-6 text-center">
              <MessageSquare className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">Select a conversation to view messages.</p>
            </div>
          )}
        </div>
      </div>
      {!isDesktop && (
        <Sheet open={selectedId !== null} onOpenChange={(open) => !open && handleClose()}>
          <SheetContent side="right" className="w-full p-0 sm:max-w-md">
            <SheetHeader className="sr-only">
              <SheetTitle>{selected?.guest_name ?? "Conversation"}</SheetTitle>
            </SheetHeader>
            {selected && (
              <ThreadView key={selected.id} thread={selected} currentUserId={currentUserId} onClose={handleClose} />
            )}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
