"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { TriangleAlertIcon, X } from "lucide-react";
import { reviewBand } from "@openbookings/pricing";
import type { ReviewReply } from "@openbookings/db/reviews";
import { AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { AttentionAlert } from "@/components/dashboard/attention-alert";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteReviewReply, editReviewReply } from "@/lib/reviews/actions";
import type { HostReportStatus, HostReview } from "@/lib/reviews/shape";
import { hostReplyNotice, type HostReplyNotice } from "@/lib/reviews/reply-notice";
import { byline, RULES_PAGE, SCORE_CHIP, stayMonthLabel } from "./labels";
import { counter, ReplyComposer, ReplyField } from "./reply-composer";
import { ReportDialog } from "./report-dialog";

/** The property's report on a review, as the pill and the line under the text say it. */
const REPORT: Record<HostReportStatus, { pill: string; tone: StatusTone; line: string }> = {
  open: {
    pill: "Reported · being checked",
    tone: "attention",
    line: "Still visible on your page while we check it. You'll hear the outcome by email.",
  },
  upheld: {
    pill: "Report upheld: removed",
    tone: "stopped",
    line: "We removed it for breaking our review rules. It's no longer on your page.",
  },
  dismissed: {
    pill: "Report not upheld",
    tone: "neutral",
    line: "We checked it against our review rules and kept it. You can report it again if something new comes up.",
  },
};

export function ReviewDetail({ review, onClose }: { review: HostReview; onClose?: () => void }) {
  const [reporting, setReporting] = React.useState(false);
  const lastId = review.replies.at(-1)?.id ?? null;
  const report = review.report ? REPORT[review.report] : null;
  // Only a published review can be reported, and not while the property's report on it is open.
  const canReport = review.status === "published" && review.report !== "open";

  return (
    <div className="flex flex-1 flex-col overflow-y-auto rounded-xl border">
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
        {report ? <StatusBadge tone={report.tone}>{report.pill}</StatusBadge> : null}
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
          {canReport ? (
            <Button
              type="button"
              variant="link"
              onClick={() => setReporting(true)}
              className="h-auto p-0 text-xs font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Report…
            </Button>
          ) : null}
        </div>
        {report ? <p className="text-xs text-muted-foreground">{report.line}</p> : null}
      </div>
      {canReport ? <ReportDialog target={{ kind: "review", id: review.id }} open={reporting} onOpenChange={setReporting} /> : null}

      {/* A review removed on the property's report has no thread left to answer. */}
      <div className={cn("flex flex-col gap-3.5 border-t px-4 py-4 sm:px-5", review.status === "removed" && "hidden")}>
        {review.status === "pending" ? (
          <AttentionAlert role="status">
            <TriangleAlertIcon />
            <AlertDescription className="text-foreground">
              Our automated check held this review for a person. It isn&apos;t public yet.
            </AlertDescription>
          </AttentionAlert>
        ) : null}

        {review.replies.map((reply) => (
          <ThreadReply key={reply.id} review={review} reply={reply} isLast={reply.id === lastId} />
        ))}

        {Object.entries(review.replyReports).some(([id, status]) => status === "upheld" && !review.replies.some((r) => r.id === id)) ? (
          <p className="text-xs text-muted-foreground">
            {review.authorName}&apos;s answer you reported was removed for breaking our review rules.
          </p>
        ) : null}

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
  const [reporting, setReporting] = React.useState(false);
  const reportStatus = review.replyReports[reply.id] ?? null;
  const report = reportStatus ? REPORT[reportStatus] : null;
  // A guest's live answer on a live review; never the property's own replies.
  const canReport = !isHost && reply.status === "published" && review.status === "published" && reportStatus !== "open";
  // The property's own reply: held, removed, or published with parts removed.
  const notice = reply.moderation
    ? hostReplyNotice({ status: reply.status, moderation: reply.moderation, bookingId: review.bookingId, timeZone: review.timeZone, now: new Date() })
    : null;
  // A removed reply can't be edited, and stays in the thread (it keeps its turn).
  const removed = reply.status === "removed";
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
          {reply.status === "pending" && !notice ? " · Being checked" : ""}
        </span>
        {report ? <StatusBadge tone={report.tone}>{report.pill}</StatusBadge> : null}
        {notice ? <StatusBadge tone={notice.tone}>{notice.pill}</StatusBadge> : null}
        {canReport ? (
          <Button variant="ghost" size="xs" onClick={() => setReporting(true)}>
            Report…
          </Button>
        ) : null}
        {isHost && !editing && !removed ? (
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
      ) : removed ? null : (
        <p className="text-sm leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{reply.body}</p>
      )}
      {notice && !editing ? <ReplyNotice notice={notice} /> : null}
      {report ? <p className="text-xs text-muted-foreground">{report.line}</p> : null}
      {canReport ? <ReportDialog target={{ kind: "answer", id: reply.id }} open={reporting} onOpenChange={setReporting} /> : null}
    </div>
  );
}

/** What moderation did with the property's own reply, under it: compact, the details the texts promise. */
function ReplyNotice({ notice }: { notice: HostReplyNotice }) {
  if (notice.state === "held") return <p className="text-xs text-muted-foreground">{notice.line}</p>;
  return (
    <div className="flex flex-col gap-1.5 pt-0.5 text-xs text-muted-foreground">
      <p>{notice.line}</p>
      <p>
        {notice.state === "removed" ? "It broke" : "Those parts seemed to break"} {notice.rules.length > 0 ? "these" : "our"}{" "}
        <a href={RULES_PAGE} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
          review rules
        </a>
        {notice.rules.length > 0 ? ":" : "."}
      </p>
      {notice.rules.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4">
          {notice.rules.map((rule) => (
            <li key={rule.title}>
              <span className="font-medium text-foreground">{rule.title}</span>: {rule.description}
            </li>
          ))}
        </ul>
      ) : null}
      {notice.note ? (
        <p className="rounded-md bg-muted/50 px-2.5 py-1.5">
          <span className="font-medium text-foreground">Note from our team:</span> {notice.note}
        </p>
      ) : null}
      {notice.written !== null ? (
        <p className="rounded-md bg-muted/50 px-2.5 py-1.5 whitespace-pre-line [overflow-wrap:anywhere]">
          <span className="font-medium text-foreground">What you wrote:</span> {notice.written}
        </p>
      ) : null}
      <p>
        Think we got it wrong?{" "}
        <a href={notice.objection} className="underline underline-offset-2 hover:text-foreground">
          Tell us why
        </a>
        , or reply to our email.
      </p>
    </div>
  );
}
