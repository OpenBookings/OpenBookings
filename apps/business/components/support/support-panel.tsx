"use client";

import { ChevronRight, LifeBuoy, Plus, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  FloatingPanel,
  FloatingPanelClose,
  FloatingPanelContent,
  FloatingPanelDescription,
  FloatingPanelHeader,
  FloatingPanelTitle,
} from "@/components/ui/floating-panel";
import { findCategory } from "@/lib/support/categories";
import { PanelChat } from "./panel-chat";
import { NewTicketDialog } from "./new-ticket-dialog";
import { useSupport } from "./support-provider";
import { TicketStatusBadge, UnreadDot } from "./ticket-bits";

function PanelHome() {
  const support = useSupport();
  return (
    <>
      <FloatingPanelHeader>
        <FloatingPanelTitle>Support</FloatingPanelTitle>
        <FloatingPanelClose asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Close support">
            <X />
          </Button>
        </FloatingPanelClose>
      </FloatingPanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {support.openTickets.length > 0 ? (
          <section aria-labelledby="support-open-tickets" className="flex flex-col gap-2">
            <h3 id="support-open-tickets" className="text-xs font-medium text-muted-foreground">
              Your open tickets
            </h3>
            <ul className="flex flex-col divide-y rounded-lg border">
              {support.openTickets.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => support.setView({ name: "chat", ticketId: ticket.id })}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <UnreadDot unread={ticket.unread} />
                    <span className="min-w-0 flex-1 truncate text-sm" title={ticket.title}>
                      {ticket.title}
                    </span>
                    <TicketStatusBadge status={ticket.status} assistantEnabled={support.assistantEnabled} />
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <LifeBuoy className="size-5" />
            </div>
            <p className="text-sm font-medium">No open tickets</p>
            <p className="text-xs text-muted-foreground">Questions about bookings, payouts or your listing? Start one here.</p>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t p-4">
        <Button onClick={() => support.openIntake()} className="w-full">
          <Plus />
          New ticket
        </Button>
        <Button variant="link" size="sm" asChild>
          <Link href="/support" onClick={support.closePanel}>
            All tickets
          </Link>
        </Button>
      </div>
    </>
  );
}

/**
 * The support panel: Home and Chat (Resolved is Chat read-only). New tickets
 * start in a dialog over the page (NewTicketDialog) and land back here.
 */
export function SupportPanel() {
  const support = useSupport();
  const { view } = support;
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const goHome = () => support.setView({ name: "home" });

  // Focus follows the view: the composer in a chat.
  React.useEffect(() => {
    if (!support.open) return;
    const target = view.name === "chat" ? composerRef.current : null;
    const frame = requestAnimationFrame(() => target?.focus());
    return () => cancelAnimationFrame(frame);
  }, [support.open, view]);

  return (
    <>
    <FloatingPanel open={support.open} onOpenChange={(open) => (open ? support.openPanel() : support.closePanel())}>
      <FloatingPanelContent
        returnFocusRef={support.returnFocusRef}
        aria-describedby="support-panel-description"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <FloatingPanelDescription id="support-panel-description">
          Contact OpenBookings support
        </FloatingPanelDescription>
        {view.name === "home" ? (
          <PanelHome />
        ) : view.name === "creating" ? (
          <PanelChat
            ticketId={null}
            onBack={() => {}}
            composerRef={composerRef}
            creating={{ title: findCategory(view.draft.category)?.label ?? "New ticket", message: view.optimistic }}
          />
        ) : (
          <PanelChat key={view.ticketId} ticketId={view.ticketId} onBack={goHome} composerRef={composerRef} />
        )}
      </FloatingPanelContent>
    </FloatingPanel>
    <NewTicketDialog />
    </>
  );
}
