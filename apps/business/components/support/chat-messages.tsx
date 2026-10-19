"use client";

import { FileText, RotateCcw } from "lucide-react";
import * as React from "react";
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentGroup, AttachmentMedia, AttachmentTitle } from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMessageTimestamp } from "@/lib/format";
import type { ChatAttachment, ChatMessage, TimelineItem } from "@/lib/support/chat";
import { AI_COPY } from "@/lib/support/copy";
import { SupportMarkdown } from "./support-markdown";

function formatSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Attachments({ items }: { items: ChatAttachment[] }) {
  if (items.length === 0) return null;
  return (
    <AttachmentGroup className="flex flex-wrap gap-2">
      {items.map((a) =>
        a.kind === "image" && a.url ? (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-lg border"
            aria-label={`Open ${a.name} full size`}
          >
            {/* Chatwoot-hosted, signed blob URLs: next/image can't optimise them. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.thumbUrl ?? a.url} alt={a.name} className="size-24 object-cover" loading="lazy" />
          </a>
        ) : (
          <Attachment key={a.id} size="sm" className="max-w-56">
            <AttachmentMedia>
              <FileText />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {a.name}
                  </a>
                ) : (
                  a.name
                )}
              </AttachmentTitle>
              {formatSize(a.size) ? <AttachmentDescription>{formatSize(a.size)}</AttachmentDescription> : null}
            </AttachmentContent>
          </Attachment>
        ),
      )}
    </AttachmentGroup>
  );
}

function GroupHeader({ kind, senderName }: { kind: ChatMessage["kind"]; senderName: string | null }) {
  if (kind === "assistant") {
    return (
      <MessageHeader className="gap-1.5 px-0">
        <span>{AI_COPY.assistantName}</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] leading-4">
          {AI_COPY.assistantBadge}
        </Badge>
      </MessageHeader>
    );
  }
  if (kind === "person") {
    return (
      <MessageHeader className="gap-1">
        <span className="text-foreground">{senderName ?? "OpenBookings"}</span>
        <span>· {AI_COPY.teamLabel}</span>
      </MessageHeader>
    );
  }
  return null;
}

export function ChatMessages({
  items,
  loading,
  appOrigin,
  onRetry,
  answerCheck,
  footer,
}: {
  items: TimelineItem[];
  loading: boolean;
  appOrigin: string | null;
  onRetry: (key: string) => void;
  /** Rendered under the latest assistant message only. */
  answerCheck?: { messageKey: string; node: React.ReactNode };
  /** The activity line (orb / typing / waiting), at the bottom. */
  footer?: React.ReactNode;
}) {
  return (
    <MessageScrollerProvider>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent
            className="justify-end gap-4 p-3"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Conversation"
          >
            {loading ? (
              <div className="flex flex-col gap-4" aria-hidden>
                <Skeleton className="ml-auto h-10 w-2/3" />
                <Skeleton className="h-14 w-3/4" />
                <Skeleton className="ml-auto h-8 w-1/2" />
              </div>
            ) : (
              items.map((item, index) => {
                const isLast = index === items.length - 1;
                if (item.type === "activity") {
                  return (
                    <MessageScrollerItem key={item.key} scrollAnchor={isLast}>
                      <Marker variant="separator" className="text-xs">
                        <MarkerContent>{item.text}</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  );
                }
                const last = item.messages.at(-1)!;
                const isHost = item.kind === "host";
                return (
                  <MessageScrollerItem key={item.key} scrollAnchor={isLast}>
                    <Message align={isHost ? "end" : "start"}>
                      <MessageContent className="gap-1.5">
                        <GroupHeader kind={item.kind} senderName={item.senderName} />
                        {item.messages.map((m) => (
                          <React.Fragment key={m.key}>
                            {m.content ? (
                              <Bubble
                                align={isHost ? "end" : "start"}
                                variant={isHost ? "muted" : item.kind === "assistant" ? "ghost" : "outline"}
                                className={m.state === "sending" ? "opacity-60" : undefined}
                              >
                                <BubbleContent>
                                  {isHost ? (
                                    <span className="whitespace-pre-wrap">{m.content}</span>
                                  ) : (
                                    <SupportMarkdown text={m.content} appOrigin={appOrigin} />
                                  )}
                                </BubbleContent>
                              </Bubble>
                            ) : null}
                            <Attachments items={m.attachments} />
                            {m.state === "failed" ? (
                              <MessageFooter className="gap-1 text-destructive">
                                Not sent.
                                <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={() => onRetry(m.key)}>
                                  <RotateCcw />
                                  Retry
                                </Button>
                              </MessageFooter>
                            ) : null}
                            {answerCheck?.messageKey === m.key ? answerCheck.node : null}
                          </React.Fragment>
                        ))}
                        {last.state !== "failed" ? (
                          <MessageFooter className={item.kind === "assistant" ? "px-0" : undefined}>
                            {last.state === "sending" ? "Sending…" : formatMessageTimestamp(new Date(last.createdAt))}
                          </MessageFooter>
                        ) : null}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })
            )}
            {footer ? <MessageScrollerItem scrollAnchor>{footer}</MessageScrollerItem> : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
