"use client";

import { ArrowLeft, Ellipsis, SendHorizonal, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FloatingPanelClose, FloatingPanelHeader, FloatingPanelTitle } from "@/components/ui/floating-panel";
import { Textarea } from "@/components/ui/textarea";
import { activityLine } from "@/lib/support/activity";
import { categoryLabel, SUPPORT_MESSAGE_MAX } from "@/lib/support/categories";
import { lastAssistantMessage, timeline, type ChatMessage } from "@/lib/support/chat";
import { AI_COPY } from "@/lib/support/copy";
import { ticketRef } from "@/lib/support/references";
import type { TicketDetail } from "@/lib/support/types";
import { waitEstimate } from "@/lib/support/working-hours";
import { AssistantActivity } from "./assistant-activity";
import { AttachButton, AttachmentChips, sendableFiles, type PickedFile } from "./attach-files";
import { ChatMessages } from "./chat-messages";
import { useSupport, type ChatState } from "./support-provider";
import { BookingRef, TicketStatusBadge } from "./ticket-bits";

function ContextStrip({ ticket }: { ticket: TicketDetail }) {
  const linked = ticket.linked;
  return (
    <div className="flex shrink-0 items-start gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
      <Badge variant="outline" className="shrink-0">
        {categoryLabel(ticket.category)}
      </Badge>
      {linked ? (
        <Link
          href={
            linked.type === "booking"
              ? `/dashboard/bookings/reservations?id=${encodeURIComponent(linked.id)}`
              : `/dashboard/listings/property?property=${encodeURIComponent(linked.id)}`
          }
          className="min-w-0 hover:underline"
        >
          {linked.type === "booking" ? <BookingRef bookingId={linked.id} stacked /> : <span className="font-medium">{linked.label}</span>}
        </Link>
      ) : null}
    </div>
  );
}

/** "Did this answer your question?" — under the latest assistant reply, while it's with the assistant. */
function AnswerCheck({ onNo, onResolve }: { onNo: () => void; onResolve: () => void }) {
  const [answer, setAnswer] = React.useState<"yes" | null>(null);
  if (answer === "yes") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Glad it helped.</span>
        <Button variant="outline" size="xs" onClick={onResolve}>
          Mark as resolved
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="group" aria-label="Did this answer your question?">
      <span>Did this answer your question?</span>
      <Button variant="outline" size="xs" onClick={() => setAnswer("yes")}>
        Yes
      </Button>
      <Button variant="outline" size="xs" onClick={onNo}>
        No
      </Button>
    </div>
  );
}

function Composer({
  ticketId,
  assistantActive,
  autoFocusRef,
}: {
  ticketId: string;
  assistantActive: boolean;
  autoFocusRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const support = useSupport();
  const [text, setText] = React.useState("");
  const [files, setFiles] = React.useState<PickedFile[]>([]);
  const ready = text.trim().length > 0 || sendableFiles(files).length > 0;

  // The composer mounts once the ticket has loaded: take focus then.
  React.useEffect(() => {
    autoFocusRef.current?.focus();
  }, [autoFocusRef]);

  const send = () => {
    if (!ready || text.length > SUPPORT_MESSAGE_MAX) return;
    void support.sendMessage(ticketId, text.trim(), sendableFiles(files));
    setText("");
    setFiles([]);
  };

  return (
    <div className="shrink-0 border-t p-2">
      <AttachmentChips files={files} onRemove={(id) => setFiles((prev) => prev.filter((f) => f.id !== id))} />
      <div className="flex items-end gap-1 pt-1">
        <AttachButton files={files} onChange={setFiles} />
        <Textarea
          ref={autoFocusRef}
          value={text}
          rows={1}
          maxLength={SUPPORT_MESSAGE_MAX}
          aria-label="Message"
          placeholder="Write a message…"
          className="max-h-32 min-h-9 resize-none py-1.5"
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value.trim()) support.notifyTyping(ticketId);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <Button size="icon-sm" aria-label="Send message" disabled={!ready} onClick={send}>
          <SendHorizonal />
        </Button>
      </div>
      <div className="flex items-center gap-1 px-1 pt-1.5 text-[11px] text-muted-foreground">
        {assistantActive ? (
          <>
            <span>{AI_COPY.composerAssistant}</span>
            <span aria-hidden>·</span>
            <Button
              variant="link"
              size="xs"
              className="h-auto px-0 text-[11px]"
              onClick={() => void support.requestPerson(ticketId, "asked")}
            >
              {AI_COPY.talkToPerson}
            </Button>
          </>
        ) : (
          <span>{AI_COPY.composerTeam}</span>
        )}
        {text.length > SUPPORT_MESSAGE_MAX * 0.9 ? (
          <span className="ml-auto tabular-nums" aria-live="polite">
            {text.length}/{SUPPORT_MESSAGE_MAX}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function useNow(intervalMs: number, active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

export function PanelChat({
  ticketId,
  onBack,
  composerRef,
  creating,
}: {
  ticketId: string | null;
  onBack: () => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  /** The optimistic first message while the ticket is being created. */
  creating?: { title: string; message: ChatMessage };
}) {
  const support = useSupport();
  const chat: ChatState | undefined = ticketId ? support.chats[ticketId] : undefined;
  const ticket = chat?.ticket ?? null;

  // Load on open; owners/admins viewing someone else's ticket have no
  // realtime, so refresh those on focus instead.
  const { loadChat, markSeen } = support;
  React.useEffect(() => {
    if (ticketId) void loadChat(ticketId);
  }, [ticketId, loadChat]);
  React.useEffect(() => {
    if (!ticketId || !ticket?.readOnly) return;
    const onFocus = () => void loadChat(ticketId);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ticketId, ticket?.readOnly, loadChat]);

  // Seen while visible: on open and whenever a message arrives.
  const messageCount = chat?.messages.length ?? 0;
  const loaded = ticket !== null;
  React.useEffect(() => {
    if (!ticketId || !loaded || document.visibilityState !== "visible") return;
    markSeen(ticketId);
  }, [ticketId, loaded, messageCount, markSeen]);

  const messages = creating ? [creating.message] : (chat?.messages ?? []);
  const status = ticket?.status ?? "pending";
  const assistantActive = support.assistantEnabled && status === "pending";
  const now = useNow(5000, assistantActive && messages.at(-1)?.kind === "host");
  const line = ticket?.readOnly
    ? null
    : activityLine({
        assistantEnabled: support.assistantEnabled,
        status,
        messages,
        botTyping: chat?.botTyping ?? false,
        personTyping: chat?.personTyping ?? null,
        lastHostAt: creating ? creating.message.createdAt : (chat?.lastHostAt ?? null),
        waitEstimate: waitEstimate(support.hours),
        now,
      });

  const items = timeline(messages, {
    handedOffAt: ticket?.handedOffAt ? Date.parse(ticket.handedOffAt) : null,
    resolvedAt: ticket?.resolvedAt ? Date.parse(ticket.resolvedAt) : null,
    status,
  });
  const latestAssistant = assistantActive && !ticket?.readOnly ? lastAssistantMessage(messages) : null;
  const canResolve = Boolean(ticket && !ticket.readOnly && status !== "resolved");

  const followUp = () => {
    if (!ticket) return;
    support.openIntake({
      category: ticket.category,
      linked: ticket.linked ? { ...ticket.linked, detail: "" } : null,
      followUpOf: ticket.id,
    });
  };

  return (
    <>
      <FloatingPanelHeader>
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <FloatingPanelTitle className="flex items-center gap-1.5">
          <span className="truncate" title={ticket?.title ?? creating?.title}>
            {ticket?.title ?? creating?.title ?? "Ticket"}
          </span>
          {ticket ? <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{ticketRef(ticket.reference)}</span> : null}
        </FloatingPanelTitle>
        {ticket ? <TicketStatusBadge status={status} assistantEnabled={support.assistantEnabled} /> : null}
        {canResolve ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Ticket actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => ticketId && void support.resolveTicket(ticketId)}>
                Mark as resolved
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <FloatingPanelClose asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Close support">
            <X />
          </Button>
        </FloatingPanelClose>
      </FloatingPanelHeader>

      {ticket ? <ContextStrip ticket={ticket} /> : null}
      {support.connection === "reconnecting" && !ticket?.readOnly ? (
        <p className="shrink-0 border-b px-3 py-1 text-center text-[11px] text-muted-foreground" role="status">
          Reconnecting…
        </p>
      ) : null}
      {ticket?.readOnly ? (
        <p className="shrink-0 border-b px-3 py-1.5 text-xs text-muted-foreground">
          Opened by {ticket.openedBy?.name ?? "a former member"} · view only
        </p>
      ) : null}

      {chat?.error && !ticket ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <p role="alert">{chat.error}</p>
          <Button variant="outline" size="sm" onClick={() => ticketId && void loadChat(ticketId)}>
            Try again
          </Button>
        </div>
      ) : (
        <ChatMessages
          items={items}
          loading={!creating && (!chat || (chat.loading && chat.messages.length === 0))}
          appOrigin={support.appOrigin}
          onRetry={(key) => ticketId && support.retryMessage(ticketId, key)}
          answerCheck={
            latestAssistant && ticketId
              ? {
                  messageKey: latestAssistant.key,
                  node: (
                    <AnswerCheck
                      key={latestAssistant.key}
                      onNo={() => void support.requestPerson(ticketId, "not_answered")}
                      onResolve={() => void support.resolveTicket(ticketId)}
                    />
                  ),
                }
              : undefined
          }
          footer={
            line ? (
              <AssistantActivity
                line={line}
                onTalkToPerson={ticketId ? () => void support.requestPerson(ticketId, "asked") : undefined}
              />
            ) : null
          }
        />
      )}

      {chat?.error && ticket ? (
        <p className="shrink-0 px-3 pb-1 text-xs text-destructive" role="alert">
          {chat.error}
        </p>
      ) : null}

      {creating ? (
        <div className="shrink-0 border-t p-3 text-xs text-muted-foreground">Starting your chat…</div>
      ) : ticket && status === "resolved" ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t p-3 text-sm">
          <span className="text-muted-foreground">This ticket is resolved. Still need help?</span>
          {!ticket.readOnly ? (
            <Button size="sm" onClick={followUp}>
              Open a new ticket
            </Button>
          ) : null}
        </div>
      ) : ticket && !ticket.readOnly && ticketId ? (
        <Composer ticketId={ticketId} assistantActive={assistantActive} autoFocusRef={composerRef} />
      ) : null}
    </>
  );
}
