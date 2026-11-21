"use client";

import * as React from "react";
import { toast } from "sonner";
import { REPLY_BODY_MAX } from "@openbookings/pricing";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { replyToReview, skipReviewReply, type ReplyActionResult } from "@/lib/reviews/actions";
import { needsReply, type HostReview } from "@/lib/reviews/shape";

type Mode = "public" | "private";

const DONE: Record<Exclude<ReplyActionResult, { ok: false }>["status"], string> = {
  published: "Reply published",
  pending: "Reply held for a check",
  sent: "Message sent",
};

/** The text box, its counter and the error line. Shared by new replies and edits. */
export function ReplyField({
  id,
  value,
  onChange,
  placeholder,
  error,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  error: string | null;
}) {
  return (
    <>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        maxLength={REPLY_BODY_MAX}
        className="resize-y"
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function counter(text: string) {
  return `${text.trim().length.toLocaleString("en-GB")} / ${REPLY_BODY_MAX.toLocaleString("en-GB")}`;
}

/**
 * Every reply starts with one question: publicly, under the review on the
 * property page, or privately, as a message in the booking's conversation.
 * Nothing is preselected. Public is only offered when it's the host's turn
 * in the thread.
 */
export function ReplyComposer({ review }: { review: HostReview }) {
  const canPublic = review.nextRole === "host";
  const [mode, setMode] = React.useState<Mode | null>(null);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [replyAnyway, setReplyAnyway] = React.useState(false);
  const fieldId = `reply-${review.id}`;
  const skipped = review.skippedAt !== null && review.status === "published" && !needsReply(review);

  const markSkipped = (value: boolean) =>
    startTransition(async () => {
      const result = await skipReviewReply(review.id, value);
      if (!result.ok) toast.error(result.message);
      else toast.success(value ? "Marked as no reply needed" : "Back in To reply");
    });

  // Marked as needing no reply: say so, keep replying one click away.
  if (skipped && mode === null && !replyAnyway) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        <span>You marked this review as needing no reply.</span>
        <Button
          type="button"
          variant="link"
          disabled={pending}
          onClick={() => markSkipped(false)}
          className="h-auto p-0 font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Undo
        </Button>
        <Button variant="outline" size="sm" onClick={() => setReplyAnyway(true)}>
          Reply anyway
        </Button>
      </div>
    );
  }

  // Not the host's turn in the public thread: only a private message is possible, so it waits behind a quiet button.
  if (mode === null && !canPublic) {
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={() => setMode("private")}>
        Reply privately
      </Button>
    );
  }

  if (mode === null) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
        <p id={`${fieldId}-how`} className="text-sm font-semibold">
          How do you want to reply to {review.authorName}?
        </p>
        <RadioGroup
          aria-labelledby={`${fieldId}-how`}
          onValueChange={(next) => setMode(next as Mode)}
          className="gap-2 sm:grid-cols-2"
        >
          <RadioGroupCard value="public" title="Publicly" description="Shows under the review on your property page" />
          <RadioGroupCard
            value="private"
            title="Privately"
            description={`Sends a message to ${review.authorName} in Messages`}
          />
        </RadioGroup>
        {review.status === "published" && !skipped ? (
          <Button
            type="button"
            variant="link"
            disabled={pending}
            onClick={() => markSkipped(true)}
            className="h-auto self-start p-0 text-xs font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            No reply needed
          </Button>
        ) : null}
      </div>
    );
  }

  const isPublic = mode === "public";
  const helper = isPublic
    ? `${review.status === "pending" ? "Goes live together with the review. " : ""}Up to 1,000 characters. You can edit it later.`
    : "Goes to the conversation for this booking, with the review attached.";

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await replyToReview(review.id, { mode, body: text });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(DONE[result.status]);
      setText("");
      setMode(null);
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <label htmlFor={fieldId}>
          <span className="font-semibold">{isPublic ? "Public reply" : "Private message"}</span>
          <span className="text-muted-foreground">
            {" "}
            · {isPublic ? `signed ${review.propertyName}` : `to ${review.authorName} in Messages`}
          </span>
        </label>
        <Button
          type="button"
          variant="link"
          onClick={() => setMode(null)}
          className="h-auto p-0 font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {canPublic ? "Change" : "Cancel"}
        </Button>
      </div>
      <ReplyField
        id={fieldId}
        value={text}
        onChange={setText}
        placeholder={
          isPublic ? `Thank ${review.authorName}, or say what you're doing about it…` : `Write to ${review.authorName}…`
        }
        error={error}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 basis-52">
          {helper} <span className="tabular-nums">{counter(text)}</span>
        </span>
        <Button onClick={submit} disabled={pending || text.trim().length === 0}>
          {isPublic ? "Publish reply" : "Send message"}
        </Button>
      </div>
    </div>
  );
}

