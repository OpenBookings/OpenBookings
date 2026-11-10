"use client";

import * as React from "react";
import { toast } from "sonner";
import { REPLY_BODY_MAX } from "@openbookings/pricing";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { replyToReview, type ReplyActionResult } from "@/lib/reviews/actions";
import type { HostReview } from "@/lib/reviews/shape";

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
  const fieldId = `reply-${review.id}`;

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
        <p className="text-sm font-semibold">How do you want to reply to {review.authorName}?</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceButton title="Publicly" detail="Shows under the review on your property page" onClick={() => setMode("public")} />
          <ChoiceButton
            title="Privately"
            detail={`Sends a message to ${review.authorName} in Messages`}
            onClick={() => setMode("private")}
          />
        </div>
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
        <button
          type="button"
          onClick={() => setMode(null)}
          className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {canPublic ? "Change" : "Cancel"}
        </button>
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

function ChoiceButton({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-0.5 rounded-md border border-input bg-background px-3 py-2.5 text-left transition-colors hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}
