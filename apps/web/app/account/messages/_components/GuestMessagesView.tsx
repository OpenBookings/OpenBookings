"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { stayRange, stayStatus } from "../_lib/stay";
import type { GuestThreadItem } from "../_lib/threads";
import { GuestThreadView, PropertyThumb } from "./GuestThreadView";

function ThreadRow({
  thread,
  selected,
  unread,
  onSelect,
}: {
  thread: GuestThreadItem;
  selected: boolean;
  unread: boolean;
  onSelect: () => void;
}) {
  const range = stayRange(thread.check_in_date, thread.check_out_date);
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
          "grid w-full grid-cols-[44px_1fr] gap-3 rounded-xl p-2.5 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
          selected && "bg-accent",
        )}
      >
        <PropertyThumb src={thread.property_image} className="size-11 rounded-[10px]" />
        <span className="min-w-0">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{thread.property_name}</span>
            {thread.last_message_at ? (
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {formatRelativeTime(thread.last_message_at)}
              </span>
            ) : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {range ? `${thread.property_city} · ${range}` : thread.property_city}
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className={cn("truncate text-[13px]", unread ? "text-foreground/90" : "text-muted-foreground")}>{preview}</span>
            {unread ? (
              <span className="size-2 shrink-0 rounded-full bg-primary shadow-[0_0_10px_var(--primary)]">
                <span className="sr-only">Unread</span>
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Inbox and open conversation in one glass panel, side by side from `lg` up.
 * Below that they take turns: the list, or the conversation with a back
 * button. The open thread is `?id=` in the URL, so a link from a booking
 * opens it directly.
 */
export function GuestMessagesView({ threads, currentUserId }: { threads: GuestThreadItem[]; currentUserId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const selected = threads.find((t) => t.id === selectedId) ?? null;
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  // Threads opened on this visit. Their server-side unread count is stale
  // once the thread view marks the messages read.
  const [seen, setSeen] = React.useState<Set<string>>(() => new Set(selectedId ? [selectedId] : []));

  const select = (id: string | null) => {
    if (id) setSeen((prev) => new Set(prev).add(id));
    const params = new URLSearchParams(searchParams);
    if (id === null) params.delete("id");
    else params.set("id", id);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const isUnread = (t: GuestThreadItem) => t.unread_count > 0 && !seen.has(t.id);
  const visible = unreadOnly ? threads.filter(isUnread) : threads;
  const isPast = (t: GuestThreadItem) => stayStatus(t.check_in_date, t.check_out_date, t.property_today)?.phase === "past";
  const active = visible.filter((t) => !isPast(t));
  const past = visible.filter(isPast);

  const renderRows = (list: GuestThreadItem[]) =>
    list.map((thread) => (
      <ThreadRow
        key={thread.id}
        thread={thread}
        selected={thread.id === selectedId}
        unread={isUnread(thread)}
        onSelect={() => select(thread.id)}
      />
    ));

  // The panel ends where the account layout's bottom padding begins, so the
  // page itself never scrolls. --above is everything over it plus that
  // padding (layout pt + tab row below lg + page header + gaps + pb-6/pb-16);
  // recompute if the account layout's spacing changes. Capped so a tall
  // screen doesn't get an empty, oversized box.
  return (
    <div className="flex h-[calc(100dvh-var(--above))] max-h-[760px] min-h-[440px] overflow-hidden rounded-2xl border bg-card shadow-2xl backdrop-blur-md [--above:23rem] md:[--above:25rem] lg:[--above:21rem]">
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col lg:w-[290px] lg:flex-none lg:border-r", selected && "max-lg:hidden")}>
        <div className="flex gap-1.5 px-3.5 pt-3.5 pb-2" role="group" aria-label="Show">
          {[
            { label: "All", on: !unreadOnly, value: false },
            { label: "Unread", on: unreadOnly, value: true },
          ].map((f) => (
            <button
              key={f.label}
              type="button"
              aria-pressed={f.on}
              onClick={() => setUnreadOnly(f.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                f.on
                  ? "border-transparent bg-foreground/90 font-medium text-neutral-950"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">You&rsquo;re all caught up.</p>
          ) : (
            <>
              {active.length > 0 ? (
                <ul className="flex flex-col gap-0.5" aria-label="Conversations">
                  {renderRows(active)}
                </ul>
              ) : null}
              {past.length > 0 ? (
                <>
                  <h3 className="px-2.5 pt-4 pb-1 text-[11px] tracking-[0.12em] text-muted-foreground uppercase">Past stays</h3>
                  <ul className="flex flex-col gap-0.5 opacity-70" aria-label="Past stays">
                    {renderRows(past)}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", selected ? "flex" : "hidden lg:flex")}>
        {selected ? (
          <GuestThreadView key={selected.id} thread={selected} currentUserId={currentUserId} onBack={() => select(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <MessageSquare aria-hidden className="size-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">Choose a conversation to read it.</p>
          </div>
        )}
      </div>
    </div>
  );
}
