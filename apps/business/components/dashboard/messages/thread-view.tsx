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
import type { ThreadListItem, ThreadMessage } from "@/components/dashboard/messages/types";

const dayFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const POLL_INTERVAL_MS = 5000;

function dedupeAndSort(prev: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

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
  const threadId = thread.id;
  const [messages, setMessages] = React.useState<ThreadMessage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [live, setLive] = React.useState(true);

  // Initial page load.
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    fetch(`/api/threads/${threadId}/messages`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setMessages(data.messages ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Kept in sync with `messages` so the polling fallback below can read the
  // latest cursor without retriggering the SSE effect on every message.
  const messagesRef = React.useRef<ThreadMessage[]>(messages);
  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Live updates via SSE, falling back to periodic refetch if the stream drops.
  React.useEffect(() => {
    const es = new EventSource(`/api/threads/${threadId}/stream`);
    let pollId: ReturnType<typeof setInterval> | undefined;

    const stopPolling = () => {
      if (pollId) clearInterval(pollId);
      pollId = undefined;
    };

    const startPolling = () => {
      setLive(false);
      if (pollId) return;
      pollId = setInterval(() => {
        const since = messagesRef.current.at(-1)?.id;
        const url = since
          ? `/api/threads/${threadId}/messages?since=${since}`
          : `/api/threads/${threadId}/messages`;
        fetch(url)
          .then((res) => res.json())
          .then((data) => {
            if (data.messages?.length) setMessages((prev) => dedupeAndSort(prev, data.messages));
          })
          .catch(() => {});
      }, POLL_INTERVAL_MS);
    };

    es.onopen = () => {
      setLive(true);
      stopPolling();
    };
    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "message") setMessages((prev) => dedupeAndSort(prev, [payload.message]));
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => startPolling();

    return () => {
      es.close();
      stopPolling();
    };
  }, [threadId]);

  // Mark incoming (not-yet-read) messages as read while the thread is open.
  React.useEffect(() => {
    const unread = messages.filter((m) => m.sender_role !== "host" && !m.read_at && m.sender_id !== currentUserId);
    if (unread.length === 0) return;
    unread.forEach((m) => {
      fetch(`/api/messages/${m.id}/read`, { method: "PATCH" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data?.message) return;
          setMessages((prev) => prev.map((x) => (x.id === m.id ? data.message : x)));
        })
        .catch(() => {});
    });
  }, [messages, currentUserId]);

  const handleSend = async () => {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setWarning(null);
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWarning(data.error ?? "Failed to send message.");
        return;
      }
      setMessages((prev) => dedupeAndSort(prev, [data.message]));
      setInput("");
      if (data.warning) setWarning(data.warning);
    } catch {
      setWarning("Failed to send message. Check your connection.");
    } finally {
      setSending(false);
    }
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
            <MessageScrollerContent>
              {loading ? (
                <div className="flex flex-col gap-4 p-4">
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
                              {isOwn && m.read_at && " · Read"}
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
