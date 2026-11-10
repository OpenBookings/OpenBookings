"use client";

import { cn } from "@/lib/utils";
import { formatMessageTimestamp } from "@/lib/format";
import { needsReply, type HostReview } from "@/lib/reviews/shape";
import { byline, SCORE_CHIP, stayMonthLabel } from "./labels";

function Trailing({ review }: { review: HostReview }) {
  if (review.status === "pending") {
    return (
      <span className="shrink-0 rounded-full bg-(--amber-3) px-2 py-px text-[11px] whitespace-nowrap text-(--amber-11)">
        Being checked
      </span>
    );
  }
  if (needsReply(review)) {
    return <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Waiting for a reply" />;
  }
  const replied = review.replies.some((r) => r.role === "host");
  if (!replied && !review.privateReplyAt) return null;
  return (
    <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">
      {replied ? "Replied" : "Replied privately"}
    </span>
  );
}

function ReviewRow({ review, selected, onSelect }: { review: HostReview; selected: boolean; onSelect: () => void }) {
  const open = needsReply(review);
  return (
    <button
      type="button"
      onClick={onSelect}
      data-state={selected ? "selected" : undefined}
      className="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/50 data-[state=selected]:bg-muted"
    >
      <span className={cn(SCORE_CHIP, "mt-0.5 h-[26px] min-w-[30px] px-1.5 text-sm")}>{review.score}</span>
      <span className="block min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", open ? "font-semibold" : "font-medium")}>{byline(review)}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatMessageTimestamp(review.postedAt)}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {review.propertyName} · {stayMonthLabel(review.stayMonth)}
        </span>
        <span className="mt-1 flex items-center justify-between gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", open ? "text-foreground" : "text-muted-foreground")}>
            {review.body ?? "Score only"}
          </span>
          <Trailing review={review} />
        </span>
      </span>
    </button>
  );
}

export function ReviewsList({
  reviews,
  selectedId,
  onSelect,
  emptyMessage,
}: {
  reviews: HostReview[];
  selectedId: string | null;
  onSelect: (review: HostReview) => void;
  emptyMessage: string;
}) {
  if (reviews.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <div className="flex flex-col">
      {reviews.map((r) => (
        <ReviewRow key={r.id} review={r} selected={r.id === selectedId} onSelect={() => onSelect(r)} />
      ))}
    </div>
  );
}
