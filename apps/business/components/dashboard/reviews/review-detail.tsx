"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { X } from "lucide-react";
import { reviewBand } from "@openbookings/pricing";
import type { ReviewReply } from "@openbookings/db/reviews";
import { Button } from "@/components/ui/button";
import { useOptionalSupport } from "@/components/support/support-provider";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteReviewReply, editReviewReply } from "@/lib/reviews/actions";
import type { HostReview } from "@/lib/reviews/shape";
import { byline, SCORE_CHIP, stayMonthLabel } from "./labels";
import { counter, ReplyComposer, ReplyField } from "./reply-composer";

export function ReviewDetail({ review, onClose }: { review: HostReview; onClose?: () => void }) {
  const support = useOptionalSupport();
  const lastId = review.replies.at(-1)?.id ?? null;

  const report = () =>
    support?.openIntake({
      category: "bookings",
      linked: { type: "booking", id: review.bookingId, label: `Booking #${review.bookingId.slice(0, 8)}`, detail: `Review by ${review.authorName}` },
      locked: true,
    });

  return (
    <div className="flex flex-1 flex-col overflow-y-auto rounded-lg border">
      <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2.5 border-b px-4 py-4 sm:px-5">
        <span className={cn(SCORE_CHIP, "h-10 min-w-11 px-2 text-lg")}>{review.score}</span>
        <div className="min-w-0 flex-1 basis-44">
          <div className="text-[15px] font-semibold">
            {reviewBand(review.score).label} · {byline(review)}
          </div>
          <div className="text-xs text-muted-foreground">
            Stayed {stayMonthLabel(review.stayMonth)}
            {review.roomLabel ? ` · ${review.roomLabel}` : ""}
          </div>
          <div className="text-xs text-muted-foreground">{review.propertyName}</div>
        </div>
        {onClose ? (
          <Button variant="ghost" size="icon" className="-mt-1 -mr-2" onClick={onClose} aria-label="Close review">
            <X />
          </Button>
        ) : null}
        <Button variant="outline" size="sm" className={onClose ? "order-last" : undefined} asChild>
          <Link href={`/dashboard/bookings/reservations?id=${review.bookingId}`}>View reservation</Link>
        </Button>
      </div>

      <div className="flex flex-col gap-3.5 px-4 py-4 sm:px-5">
        {review.body ? (
          <p className="max-w-prose text-sm leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{review.body}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{review.authorName} gave a score without writing a review.</p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Posted {formatRelativeTime(review.postedAt)}</span>
          <span>Verified stay</span>
          {support ? (
            <button type="button" onClick={report} className="underline underline-offset-2 hover:text-foreground">
              Report
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3.5 border-t px-4 py-4 sm:px-5">
        {review.status === "pending" ? (
          <p className="rounded-md bg-(--amber-3) px-3 py-2.5 text-sm text-(--amber-11)">
            Our automated check held this review for a person. It isn&apos;t public yet.
          </p>
        ) : null}

        {review.replies.map((reply) => (
          <ThreadReply key={reply.id} review={review} reply={reply} isLast={reply.id === lastId} />
        ))}

        {review.privateReplyAt ? (
          <p className="text-xs text-muted-foreground">
            You replied privately in Messages {formatRelativeTime(review.privateReplyAt)}.{" "}
            <Link href="/dashboard/bookings/messages" className="underline underline-offset-2 hover:text-foreground">
              Open conversation
            </Link>
          </p>
        ) : null}

        <ReplyComposer key={`${review.id}:${review.replies.length}`} review={review} />

        {review.nextRole === null ? (
          <p className="text-xs text-muted-foreground">This thread is closed. Carry on in Messages.</p>
        ) : review.nextRole === "host" && review.replies.length === 2 ? (
          <p className="text-xs text-muted-foreground">This is the last reply in the thread. After it, carry on in Messages.</p>
        ) : null}
      </div>
    </div>
  );
}

function ThreadReply({ review, reply, isLast }: { review: HostReview; reply: ReviewReply; isLast: boolean }) {
  const isHost = reply.role === "host";
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(reply.body);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, startTransition] = React.useTransition();

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await editReviewReply(reply.id, text);
      if (!result.ok) return setError(result.message);
      toast.success(result.status === "pending" ? "Reply held for a check" : "Reply updated");
      setEditing(false);
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteReviewReply(reply.id);
      if (!result.ok) toast.error(result.message);
      else toast.success("Reply deleted");
    });

  const when = reply.publishedAt ?? reply.createdAt;
  return (
    <div className={cn("flex flex-col gap-1 border-l-2 pl-3.5", isHost ? "border-border" : "ml-4 border-primary/50")}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">
            {isHost ? `Response from ${review.propertyName}` : `${review.authorName} answered`}
          </span>{" "}
          · {formatRelativeTime(when)}
          {reply.editedAt ? " · Edited" : ""}
          {reply.status === "pending" ? " · Being checked" : ""}
        </span>
        {isHost && !editing ? (
          <span className="flex gap-1">
            <Button variant="ghost" size="xs" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </Button>
            {isLast ? (
              <Button variant="ghost" size="xs" onClick={remove} disabled={busy}>
                Delete
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2 pt-1">
          <ReplyField id={`edit-${reply.id}`} value={text} onChange={setText} placeholder="" error={error} />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{counter(text)}</span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => (setEditing(false), setText(reply.body))} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={busy || text.trim().length === 0}>
                Save
              </Button>
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{reply.body}</p>
      )}
    </div>
  );
}
