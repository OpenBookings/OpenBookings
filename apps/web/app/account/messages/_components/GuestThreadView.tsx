"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUp, Hotel } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { nightsBetween, runPosition, STARTER_QUESTIONS, stayRange, stayStatus } from "../_lib/stay";
import type { GuestThreadItem } from "../_lib/threads";

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

export function PropertyThumb({ src, className }: { src: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-secondary text-muted-foreground",
        className,
      )}
    >
      {src ? <Image src={src} alt="" fill sizes="56px" className="object-cover" /> : <Hotel aria-hidden className="size-5" />}
    </span>
  );
}

/** The stay this conversation is about, pinned above the messages. */
function StayStrip({ thread, live, onBack }: { thread: GuestThreadItem; live: boolean; onBack?: () => void }) {
  const status = stayStatus(thread.check_in_date, thread.check_out_date, thread.property_today);
  const range = stayRange(thread.check_in_date, thread.check_out_date);
  const nights =
    thread.check_in_date && thread.check_out_date ? nightsBetween(thread.check_in_date, thread.check_out_date) : null;
  const glows = status?.phase === "upcoming" || status?.phase === "current";

  return (
    <div className="flex items-center gap-3 border-b px-3 py-3 sm:gap-3.5 sm:px-5 sm:py-3.5">
      {onBack ? (
        <Button variant="ghost" size="icon" className="size-8 shrink-0 lg:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft />
        </Button>
      ) : null}
      <PropertyThumb src={thread.property_image} className="size-10 rounded-[10px] sm:size-13 sm:rounded-xl" />
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-serif text-[17px] leading-tight sm:text-xl">{thread.property_name}</h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground">
          {status ? (
            <span className={cn("inline-flex items-center gap-1.5", glows && "font-medium text-foreground")}>
              {glows ? <span aria-hidden className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" /> : null}
              {status.label}
            </span>
          ) : null}
          {range ? (
            <>
              {status ? <span aria-hidden>·</span> : null}
              <span>{range}</span>
            </>
          ) : null}
          {nights ? (
            <span className="max-sm:hidden">
              <span aria-hidden className="mr-2">
                ·
              </span>
              {nights === 1 ? "1 night" : `${nights} nights`}
            </span>
          ) : null}
          {!live ? (
            <Badge variant="outline" className="text-[11px]">
              Reconnecting
            </Badge>
          ) : null}
        </p>
      </div>
      {thread.booking_id ? (
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href={`/bookings/${thread.booking_id}`}>
            <span className="sm:hidden">Booking</span>
            <span className="max-sm:hidden">View booking</span>
          </Link>
        </Button>
      ) : null}
    </div>
  );
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
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const { messages, loading, live, sending, warning, send } = useThreadMessages({
    threadId: thread.id,
    currentUserId,
    selfRole: "guest",
  });
  const closed = thread.status === "closed";

  const handleSend = async () => {
    if (await send(input)) setInput("");
  };

  const prefill = (question: string) => {
    setInput(question);
    inputRef.current?.focus();
  };

  let lastDay = "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StayStrip thread={thread} live={live} onBack={onBack} />

      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="justify-end gap-0 px-4 py-4 sm:px-6">
              {loading ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-10 w-2/3 rounded-2xl" />
                  <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
                  <Skeleton className="h-10 w-3/5 rounded-2xl" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
                  <div className="max-w-xs">
                    <p className="font-serif text-xl">Say hello to {thread.property_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Ask anything about your stay. They know the place and the city best.
                    </p>
                  </div>
                  {!closed ? (
                    <ul className="flex max-w-md flex-wrap justify-center gap-2" aria-label="Suggested questions">
                      {STARTER_QUESTIONS.map((q) => (
                        <li key={q}>
                          <button
                            type="button"
                            onClick={() => prefill(q)}
                            className="rounded-full border bg-muted px-3 py-1.5 text-xs text-foreground/90 transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >
                            {q}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                messages.map((m, i) => {
                  const label = dayLabel(m.created_at);
                  const showDivider = label !== lastDay;
                  lastDay = label;
                  const isOwn = m.sender_role === "guest";
                  const { first, last } = runPosition(messages, i, dayLabel);
                  return (
                    <React.Fragment key={m.id}>
                      {showDivider ? (
                        <MessageScrollerItem className="pt-3 pb-2">
                          <Marker variant="separator">
                            <MarkerContent>{label}</MarkerContent>
                          </Marker>
                        </MessageScrollerItem>
                      ) : null}
                      <MessageScrollerItem scrollAnchor={i === messages.length - 1} className={cn(first ? "pt-2" : "pt-1")}>
                        <Message align={isOwn ? "end" : "start"}>
                          <MessageContent>
                            {first && !isOwn ? (
                              <span className="mb-0.5 ml-0.5 text-[11.5px] text-muted-foreground">{thread.property_name}</span>
                            ) : null}
                            <Bubble align={isOwn ? "end" : "start"} variant={isOwn ? "default" : "secondary"}>
                              <BubbleContent
                                className={cn(
                                  "rounded-2xl px-3.5 py-2.5 whitespace-pre-wrap",
                                  isOwn ? "bg-foreground/90! text-neutral-950!" : "border-border/60! bg-secondary!",
                                  !first && (isOwn ? "rounded-tr-md" : "rounded-tl-md"),
                                )}
                              >
                                {m.sender_id === null ? <span className="opacity-60 italic">{m.body}</span> : m.body}
                              </BubbleContent>
                            </Bubble>
                            {last ? <MessageFooter>{formatMessageTimestamp(m.created_at)}</MessageFooter> : null}
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
        <div className="flex flex-col gap-2 px-3 pt-2 pb-3 sm:px-4">
          <div className="flex items-end gap-2 rounded-3xl border border-input bg-muted py-1.5 pr-1.5 pl-4 transition-shadow focus-within:ring-[3px] focus-within:ring-ring/50">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={`Write to ${thread.property_name}…`}
              aria-label={`Message ${thread.property_name}`}
              rows={1}
              className="max-h-40 min-h-8 resize-none border-0 bg-transparent! px-0 py-1.5 shadow-none focus-visible:ring-0"
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="size-8 shrink-0 rounded-full bg-foreground/90 text-neutral-950 hover:bg-foreground"
            >
              <ArrowUp />
            </Button>
          </div>
          <p className="text-center text-[11.5px] text-muted-foreground">
            Keep bookings, payments and contact details on OpenBookings.
          </p>
        </div>
      )}
    </div>
  );
}
