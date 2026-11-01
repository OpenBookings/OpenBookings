"use client";

import * as React from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Hotel, MessageSquare } from "lucide-react";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GuestThreadItem } from "../_lib/threads";
import { GuestThreadView, stayLabel } from "./GuestThreadView";

function ThreadRow({ thread, selected, onSelect }: { thread: GuestThreadItem; selected: boolean; onSelect: () => void }) {
  const unread = thread.unread_count > 0;
  const stay = stayLabel(thread);
  const preview =
    thread.last_message_body === null
      ? "No messages yet"
      : `${thread.last_message_sender_role === "guest" ? "You: " : ""}${thread.last_message_body}`;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-accent focus-visible:bg-accent",
          selected && "bg-accent",
        )}
      >
        <span className="relative mt-0.5 flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-secondary text-muted-foreground">
          {thread.property_image ? (
            <Image src={thread.property_image} alt="" fill sizes="40px" className="object-cover" />
          ) : (
            <Hotel aria-hidden className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{thread.property_name}</span>
            {thread.last_message_at ? (
              <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(thread.last_message_at)}</span>
            ) : null}
          </span>
          {stay ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{stay}</span> : null}
          <span className="mt-1 flex items-center justify-between gap-2">
            <span className={cn("truncate text-[13px]", unread ? "text-foreground" : "text-muted-foreground")}>{preview}</span>
            {unread ? (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground tabular-nums">
                <span className="sr-only">Unread: </span>
                {thread.unread_count}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Inbox and open conversation side by side from `lg` up. Below that they take
 * turns: the list, or the conversation with a back button. The open thread is
 * `?id=` in the URL, so a link from a booking opens it directly.
 */
export function GuestMessagesView({ threads, currentUserId }: { threads: GuestThreadItem[]; currentUserId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const selected = threads.find((t) => t.id === selectedId) ?? null;

  const select = (id: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (id === null) params.delete("id");
    else params.set("id", id);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="flex h-[calc(100dvh-16rem)] min-h-[480px] items-stretch gap-4">
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto rounded-lg border bg-card lg:max-w-sm lg:flex-none lg:basis-80",
          selected && "max-lg:hidden",
        )}
      >
        <ul className="divide-y" aria-label="Conversations">
          {threads.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} selected={thread.id === selectedId} onSelect={() => select(thread.id)} />
          ))}
        </ul>
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", selected ? "flex" : "hidden lg:flex")}>
        {selected ? (
          <GuestThreadView key={selected.id} thread={selected} currentUserId={currentUserId} onBack={() => select(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border p-6 text-center">
            <MessageSquare aria-hidden className="size-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">Select a conversation to read it.</p>
          </div>
        )}
      </div>
    </div>
  );
}
