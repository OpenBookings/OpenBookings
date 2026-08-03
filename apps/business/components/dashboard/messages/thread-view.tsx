"use client";

import * as React from "react";
import { SendHorizonal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@/components/ui/message-scroller";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { formatMessageTimestamp } from "@/lib/format";
import { useThreadMessages, type ThreadListItem } from "@openbookings/messaging/client";

const dayFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return dayFormatter.format(date);
}

export function ThreadView({
  thread,
  currentUserId,
  onClose,
}: {
  thread: ThreadListItem;
  currentUserId: string;
  onClose?: () => void;
}) {
  const [input, setInput] = React.useState("");
  const { messages, loading, live, sending, warning, send } = useThreadMessages({
    threadId: thread.id,
    currentUserId,
    selfRole: "host",
  });

  const handleSend = async () => {
    if (await send(input)) setInput("");
  };

  let lastDay = "";

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{thread.guest_name ?? "Guest"}</div>
          <div className="truncate text-xs text-muted-foreground">{thread.property_name}</div>
        </div>
        <div className="flex items-center gap-2">
          {!live && (
            <Badge variant="outline" className="text-xs">
              Reconnecting
            </Badge>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close thread">
              <X />
            </Button>
          )}
        </div>
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
                  No messages yet. Say hello!
                </p>
              ) : (
                messages.map((m, i) => {
                  const label = dayLabel(m.created_at);
                  const showDivider = label !== lastDay;
                  lastDay = label;
                  const isOwn = m.sender_role === "host";
                  const isLast = i === messages.length - 1;

                  return (
                    <React.Fragment key={m.id}>
                      {showDivider && (
                        <MessageScrollerItem>
                          <Marker variant="separator">
                            <MarkerContent>{label}</MarkerContent>
                          </Marker>
                        </MessageScrollerItem>
                      )}
                      <MessageScrollerItem scrollAnchor={isLast}>
                        <Message align={isOwn ? "end" : "start"}>
                          <MessageContent>
                            <Bubble align={isOwn ? "end" : "start"} variant={isOwn ? "default" : "secondary"}>
                              <BubbleContent>
                                {m.sender_id === null ? (
                                  <span className="italic text-muted-foreground">{m.body}</span>
                                ) : (
                                  m.body
                                )}
                              </BubbleContent>
                            </Bubble>
                            <MessageFooter>
                              {formatMessageTimestamp(m.created_at)}
                              {m.flagged_reason && (
                                <Badge variant="outline" className="ml-1.5 px-1.5 text-[10px]">
                                  Flagged
                                </Badge>
                              )}
                            </MessageFooter>
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

      {warning && <div className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-800">{warning}</div>}

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
          placeholder="Write a message..."
          rows={1}
          className="min-h-9 resize-none"
        />
        <Button size="icon" onClick={handleSend} disabled={sending || !input.trim()} aria-label="Send message">
          <SendHorizonal />
        </Button>
      </div>
    </div>
  );
}
