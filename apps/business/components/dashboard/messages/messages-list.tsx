"use client";

import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import type { ThreadListItem } from "@openbookings/messaging/client";

function initials(name: string | null): string {
  if (!name) return "G";
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: ThreadListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const unread = thread.unread_count > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      data-state={selected ? "selected" : undefined}
      className={cn(
        "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50",
        "data-[state=selected]:bg-muted",
      )}
    >
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground">
        {thread.guest_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thread.guest_image} alt="" className="size-full object-cover" />
        ) : (
          initials(thread.guest_name)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
            {thread.guest_name ?? "Guest"}
          </span>
          {thread.last_message_at && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelativeTime(thread.last_message_at)}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{thread.property_name}</div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", unread ? "text-foreground" : "text-muted-foreground")}>
            {thread.last_message_sender_role === "host" && "You: "}
            {thread.last_message_body ?? "No messages yet"}
          </span>
          {unread && (
            <Badge className="shrink-0 px-1.5" variant="default">
              {thread.unread_count}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

export function MessagesList({
  threads,
  selectedId,
  onSelect,
}: {
  threads: ThreadListItem[];
  selectedId: string | null;
  onSelect: (thread: ThreadListItem) => void;
}) {
  if (threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <MessageSquare className="size-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">No conversations yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {threads.map((thread) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          selected={thread.id === selectedId}
          onSelect={() => onSelect(thread)}
        />
      ))}
    </div>
  );
}
