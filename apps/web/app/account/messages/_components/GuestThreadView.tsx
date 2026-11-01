"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, SendHorizonal } from "lucide-react";
import { useThreadMessages } from "@openbookings/messaging/client";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatMessageTimestamp } from "@/lib/format";
import type { GuestThreadItem } from "../_lib/threads";

const dayFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const stayFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return dayFormatter.format(date);
}

export function stayLabel(thread: GuestThreadItem): string | null {
  if (!thread.check_in_date || !thread.check_out_date) return null;
  const fmt = (d: string) => stayFormatter.format(new Date(`${d}T00:00:00Z`));
  return `${fmt(thread.check_in_date)} – ${fmt(thread.check_out_date)}`;
}

/** One conversation with a property, from the guest's side. Ported from apps/business ThreadView. */
export function GuestThreadView({
  thread,
  currentUserId,
  onBack,
}: {
  thread: GuestThreadItem;
  currentUserId: string;
  /** Shown on small screens, where the list and the thread take turns. */
  onBack?: () => void;
}) {
  const [input, setInput] = React.useState("");
  const { messages, loading, live, sending, warning, send } = useThreadMessages({
    threadId: thread.id,
    currentUserId,
    selfRole: "guest",
  });
  const closed = thread.status === "closed";
  const stay = stayLabel(thread);

  const handleSend = async () => {
    if (await send(input)) setInput("");
  };

  let lastDay = "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b bg-muted px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <Button variant="ghost" size="icon" className="size-8 lg:hidden" onClick={onBack} aria-label="Back to conversations">
              <ArrowLeft />
            </Button>
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{thread.property_name}</div>
            {stay ? (
              <div className="truncate text-xs text-muted-foreground">
                {thread.booking_id ? (
                  <Link href={`/bookings/${thread.booking_id}`} className="underline-offset-2 hover:underline">
                    Your stay {stay}
                  </Link>
                ) : (
                  stay
                )}
              </div>
            ) : null}
          </div>
        </div>
        {!live ? (
          <Badge variant="outline" className="text-xs">
            Reconnecting
          </Badge>
        ) : null}
      </div>

      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="justify-end p-4">
              {loading ? (
                <div className="flex flex-col gap-4">
                  <Skeleton className="h-10 w-2/3" />
                  <Skeleton className="ml-auto h-10 w-1/2" />
                  <Skeleton className="h-10 w-3/5" />
                </div>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No messages yet. Ask the property anything about your stay.
                </p>
              ) : (
                messages.map((m, i) => {
                  const label = dayLabel(m.created_at);
                  const showDivider = label !== lastDay;
                  lastDay = label;
                  const isOwn = m.sender_role === "guest";
                  return (
                    <React.Fragment key={m.id}>
                      {showDivider ? (
                        <MessageScrollerItem>
                          <Marker variant="separator">
                            <MarkerContent>{label}</MarkerContent>
                          </Marker>
                        </MessageScrollerItem>
                      ) : null}
                      <MessageScrollerItem scrollAnchor={i === messages.length - 1}>
                        <Message align={isOwn ? "end" : "start"}>
                          <MessageContent>
                            <Bubble align={isOwn ? "end" : "start"} variant={isOwn ? "default" : "secondary"}>
                              <BubbleContent>
                                {m.sender_id === null ? (
                                  <span className="text-muted-foreground italic">{m.body}</span>
                                ) : (
                                  m.body
                                )}
                              </BubbleContent>
                            </Bubble>
                            <MessageFooter>{formatMessageTimestamp(m.created_at)}</MessageFooter>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    </React.Fragment>
                  );
                })
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      {warning ? (
        <div role="alert" className="border-t bg-(--amber-3) px-4 py-2 text-xs text-(--amber-11)">
          {warning}
        </div>
      ) : null}

      {closed ? (
        <p className="border-t px-4 py-3 text-sm text-muted-foreground">This conversation is closed.</p>
      ) : (
        <div className="flex items-end gap-2 border-t p-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Write a message…"
            aria-label={`Message ${thread.property_name}`}
            rows={1}
            className="min-h-9 resize-none"
          />
          <Button size="icon" onClick={handleSend} disabled={sending || !input.trim()} aria-label="Send message">
            <SendHorizonal />
          </Button>
        </div>
      )}
    </div>
  );
}
