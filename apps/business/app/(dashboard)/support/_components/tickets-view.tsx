"use client";

import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { BookingRef, RelativeTime, TicketStatusBadge, UnreadDot } from "@/components/support/ticket-bits";
import { useOptionalSupport } from "@/components/support/support-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { categoryLabel } from "@/lib/support/categories";
import { ticketRef } from "@/lib/support/references";
import { TICKET_TABS, type TicketTab } from "@/lib/support/status";
import type { TicketSummary } from "@/lib/support/types";

export function TicketsView({
  tab,
  page,
  tickets,
  counts,
  hasNextPage,
  showOpenedBy,
  openTicketId,
}: {
  tab: TicketTab;
  page: number;
  tickets: TicketSummary[];
  counts: Record<TicketTab, number>;
  hasNextPage: boolean;
  showOpenedBy: boolean;
  openTicketId: string | null;
}) {
  // The layout mounts the provider; if its bootstrap failed, degrade to a note.
  const support = useOptionalSupport();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // No refresh button: the list revalidates on focus and when the panel
  // reports a change (a reply, a new ticket, a resolve).
  const onTicketsChanged = support?.onTicketsChanged;
  React.useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener("focus", refresh);
    const unsubscribe = onTicketsChanged?.(refresh) ?? (() => {});
    return () => {
      window.removeEventListener("focus", refresh);
      unsubscribe();
    };
  }, [router, onTicketsChanged]);

  // `?ticket=<id>` (the reply email's link) opens that ticket once.
  const opened = React.useRef<string | null>(null);
  const openPanel = support?.openPanel;
  React.useEffect(() => {
    if (!openPanel || !openTicketId || opened.current === openTicketId) return;
    opened.current = openTicketId;
    openPanel({ ticketId: openTicketId });
    const params = new URLSearchParams(searchParams);
    params.delete("ticket");
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }, [openTicketId, openPanel, router, pathname, searchParams]);

  const href = (next: { tab?: TicketTab; page?: number }) => {
    const params = new URLSearchParams();
    const nextTab = next.tab ?? tab;
    if (nextTab !== "open") params.set("tab", nextTab);
    const nextPage = next.page ?? 1;
    if (nextPage > 1) params.set("page", String(nextPage));
    return params.size ? `${pathname}?${params}` : pathname;
  };

  if (!support) {
    return (
      <p className="mx-4 rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground lg:mx-6">
        Support is unavailable right now. Please try again in a moment.
      </p>
    );
  }

  const newTicket = (
    <Button size="sm" onClick={() => support.openPanel({ newTicket: {} })}>
      New ticket
    </Button>
  );

  if (counts.all === 0) {
    return (
      <Empty className="mx-4 border lg:mx-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LifeBuoy />
          </EmptyMedia>
          <EmptyTitle>No tickets yet</EmptyTitle>
          <EmptyDescription>Questions about bookings, payouts or your listing? Start one here.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{newTicket}</EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(value) => router.push(href({ tab: value as TicketTab }))}>
          <TabsList>
            {TICKET_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                <Badge variant="secondary" className="ml-1.5 px-1.5">
                  {counts[t.value]}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {newTicket}
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
          {tab === "open" ? (
            <>
              No open tickets.{" "}
              {counts.resolved > 0 ? (
                <Link href={href({ tab: "resolved" })} className="underline underline-offset-3 hover:text-foreground">
                  See resolved tickets
                </Link>
              ) : null}
            </>
          ) : (
            "No tickets here."
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="max-md:sr-only">
              <TableRow>
                <TableHead className="w-6">
                  <span className="sr-only">Unread</span>
                </TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead className="hidden md:table-cell">Ref</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                {showOpenedBy ? <TableHead className="hidden lg:table-cell">Opened by</TableHead> : null}
                <TableHead className="hidden text-right md:table-cell">Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((ticket) => (
                <TableRow key={ticket.id} className="relative">
                  <TableCell className="w-6 align-top md:align-middle">
                    <UnreadDot unread={ticket.unread} className="mt-1.5 md:mt-0" />
                  </TableCell>
                  <TableCell className="max-w-0 min-w-0 whitespace-normal">
                    <div className="flex items-center gap-2">
                      {/* The whole row is the button's hit area. */}
                      <button
                        type="button"
                        onClick={() => support.openPanel({ ticketId: ticket.id })}
                        className="min-w-0 flex-1 truncate text-left font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
                        title={ticket.title}
                      >
                        {ticket.title}
                      </button>
                      <TicketStatusBadge
                        status={ticket.status}
                        assistantEnabled={support.assistantEnabled}
                        className="md:hidden"
                      />
                    </div>
                    {ticket.lastMessagePreview ? (
                      <p className="truncate text-xs text-muted-foreground" title={ticket.lastMessagePreview}>
                        {ticket.lastMessagePreview}
                      </p>
                    ) : null}
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground md:hidden">
                      <span className="tabular-nums">{ticketRef(ticket.reference)}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{categoryLabel(ticket.category)}</span>
                      <span aria-hidden>·</span>
                      <RelativeTime iso={ticket.lastActivityAt} className="relative z-10" />
                    </p>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                    {ticketRef(ticket.reference)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-col gap-0.5">
                      <Badge variant="outline">{categoryLabel(ticket.category)}</Badge>
                      {ticket.linked?.type === "booking" ? (
                        <span className="text-xs text-muted-foreground">
                          <BookingRef bookingId={ticket.linked.id} />
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <TicketStatusBadge status={ticket.status} assistantEnabled={support.assistantEnabled} />
                  </TableCell>
                  {showOpenedBy ? (
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {ticket.mine ? "You" : (ticket.openedBy?.name ?? "Former member")}
                    </TableCell>
                  ) : null}
                  <TableCell className="hidden text-right text-sm text-muted-foreground md:table-cell">
                    {/* Above the row's hit area, so the hover shows the full timestamp. */}
                    <RelativeTime iso={ticket.lastActivityAt} className="relative z-10" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {page > 1 || hasNextPage ? (
        <nav className="flex items-center justify-end gap-2" aria-label="Pages">
          {page > 1 ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={href({ page: page - 1 })}>Previous</Link>
            </Button>
          ) : null}
          {hasNextPage ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={href({ page: page + 1 })}>Next</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
