"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconChevronLeft,
  IconMessageCircle,
  IconPlus,
  IconSend,
  IconAlertCircle,
} from "@tabler/icons-react";
import type { Ticket, TicketStatus, Message } from "@openbookings/analytics/client";
import { usePostHog } from "@openbookings/analytics/client";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Constants ──────────────────────────────────────────────────────────────

const SUBJECTS = ["Bookings", "Property", "Finance", "Analytics", "Other"] as const;
type Subject = (typeof SUBJECTS)[number];

const STATUS_STYLES: Record<TicketStatus, string> = {
  new: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  open: "bg-green-500/10 text-green-600 dark:text-green-400",
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  on_hold: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  resolved: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "New",
  open: "Open",
  pending: "Pending",
  on_hold: "On hold",
  resolved: "Resolved",
};

type View = "loading" | "list" | "form" | "thread";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

// Tickets carry their category as a `[Subject]` prefix on the opening message,
// which the support agent sees in the inbox. Strip it for customer-facing text.
const CATEGORY_PREFIX = /^\s*\[([^\]]+)\]\s*/;

function stripCategory(text: string): string {
  return text.replace(CATEGORY_PREFIX, "");
}

// A short, human-friendly reference derived from the ticket's id.
function shortTicketId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9]/g, "");
  return (clean.slice(-6) || clean).toUpperCase();
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
        STATUS_STYLES[status]
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

export function SupportTicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const posthog = usePostHog();
  const { data: session } = authClient.useSession();

  const [view, setView] = useState<View>("loading");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [subject, setSubject] = useState<Subject | "">("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  // Thread state
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replying, setReplying] = useState(false);

  const userTraits = {
    name: session?.user?.name ?? undefined,
    email: session?.user?.email ?? undefined,
  };

  const conversations = posthog?.conversations;

  // Verify the user's identity with PostHog (HMAC-SHA256 signed server-side)
  // so tickets are bound to the authenticated account and persist across
  // browsers. Runs once per mount; failures fall back to anonymous mode.
  const identityRef = useRef(false);
  const ensureIdentity = useCallback(async () => {
    if (identityRef.current || !posthog) return;
    try {
      const res = await fetch("/api/posthog/identity");
      if (!res.ok) return;
      const { distinctId, hash } = (await res.json()) as {
        distinctId?: string;
        hash?: string;
      };
      if (distinctId && hash) {
        posthog.setIdentity(distinctId, hash);
        identityRef.current = true;
      }
    } catch {
      // Network/parse error — proceed without verified identity.
    }
  }, [posthog]);

  const loadTickets = useCallback(async () => {
    if (!conversations?.isAvailable()) {
      setError(
        "Support chat isn't available right now. Please try again later or email support@openbookings.co."
      );
      setView("list");
      return;
    }
    setView("loading");
    setError(null);
    try {
      const res = await conversations.getTickets({ limit: 20 });
      const results = (res?.results ?? []).filter(
        (ticket) => ticket.status !== "resolved"
      );
      setTickets(results);
      setView(results.length > 0 ? "list" : "form");
    } catch {
      setError("Couldn't load your tickets. Please try again.");
      setView("list");
    }
  }, [conversations]);

  // Load tickets each time the dialog opens; reset transient state on close.
  useEffect(() => {
    if (open) {
      void ensureIdentity().then(loadTickets);
    } else {
      setSubject("");
      setMessage("");
      setActiveTicket(null);
      setThreadMessages([]);
      setError(null);
    }
  }, [open, loadTickets, ensureIdentity]);

  async function openThread(ticket: Ticket) {
    setActiveTicket(ticket);
    setThreadMessages([]);
    setView("thread");
    if (!conversations?.isAvailable()) return;
    setThreadLoading(true);
    try {
      const res = await conversations.getMessages(ticket.id);
      setThreadMessages(res?.messages ?? []);
      void conversations.markAsRead(ticket.id);
    } catch {
      // Leave the thread empty; the header still shows the ticket summary.
    } finally {
      setThreadLoading(false);
    }
  }

  async function handleReply(text: string) {
    const trimmed = text.trim();
    if (!trimmed || replying || !activeTicket) return;
    if (!conversations?.isAvailable()) {
      setError(
        "Support chat isn't available right now. Please try again later or email support@openbookings.co."
      );
      return;
    }
    setReplying(true);
    setError(null);
    try {
      // Opening the thread already switched the SDK's active ticket, but
      // re-assert it so the reply lands on this ticket even if state drifted.
      if (conversations.getCurrentTicketId() !== activeTicket.id) {
        await conversations.getMessages(activeTicket.id);
      }
      await conversations.sendMessage(trimmed, userTraits);
      const res = await conversations.getMessages(activeTicket.id);
      setThreadMessages(res?.messages ?? []);
    } catch {
      setError("Your reply couldn't be sent. Please try again.");
    } finally {
      setReplying(false);
    }
  }

  async function handleSend() {
    if (!subject || !message.trim() || sending) return;
    if (!conversations?.isAvailable()) {
      setError(
        "Support chat isn't available right now. Please try again later or email support@openbookings.co."
      );
      return;
    }
    setSending(true);
    setError(null);
    try {
      const body = `[${subject}] ${message.trim()}`;
      await conversations.sendMessage(body, userTraits, true);
      // Refresh the list so the new ticket appears.
      setSubject("");
      setMessage("");
      await loadTickets();
      setView("list");
    } catch {
      setError("Your message couldn't be sent. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const showBack = view === "thread" || (view === "form" && tickets.length > 0);

  const threadTitle = activeTicket
    ? `Ticket #${shortTicketId(activeTicket.id)}`
    : "Ticket";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
        // Blur the backdrop behind the dialog.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex-row items-center gap-2 space-y-0 border-b border-border px-4 py-3">
          {showBack && (
            <button
              type="button"
              onClick={() => setView("list")}
              aria-label="Back"
              className="-ml-1 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <IconChevronLeft className="size-4" />
            </button>
          )}
          <div className="flex flex-col">
            <DialogTitle className="text-base">
              {view === "thread"
                ? threadTitle
                : view === "form"
                  ? "Create ticket"
                  : "Support"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Contact the OpenBookings support team.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="min-h-72">
          {view === "loading" && <LoadingState />}

          {view === "list" && (
            <TicketList
              tickets={tickets}
              error={error}
              onSelect={openThread}
              onCreate={() => {
                setError(null);
                setView("form");
              }}
            />
          )}

          {view === "form" && (
            <TicketForm
              subject={subject}
              message={message}
              sending={sending}
              error={error}
              onSubjectChange={setSubject}
              onMessageChange={setMessage}
              onSubmit={handleSend}
            />
          )}

          {view === "thread" && activeTicket && (
            <ThreadView
              ticket={activeTicket}
              messages={threadMessages}
              loading={threadLoading}
              error={error}
              replying={replying}
              onReply={handleReply}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Loading ──────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="space-y-2 p-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

// ─── Ticket list ────────────────────────────────────────────────────────────────

function TicketList({
  tickets,
  error,
  onSelect,
  onCreate,
}: {
  tickets: Ticket[];
  error: string | null;
  onSelect: (ticket: Ticket) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex h-96 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {error && <ErrorBanner message={error} />}
        {tickets.length === 0 && !error && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            You have no previous tickets.
          </p>
        )}
        {tickets.map((ticket) => (
          <button
            key={ticket.id}
            type="button"
            onClick={() => onSelect(ticket)}
            className="flex w-full flex-col gap-1 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/60"
          >
            <div className="flex items-center gap-2">
              <IconMessageCircle className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm font-medium text-foreground">
                Ticket #{shortTicketId(ticket.id)}
              </span>
              <StatusBadge status={ticket.status} />
            </div>
            {ticket.last_message && (
              <p className="truncate pl-6 text-xs text-muted-foreground">
                {stripCategory(ticket.last_message)}
              </p>
            )}
            <div className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
              <span>
                {ticket.message_count} message
                {ticket.message_count === 1 ? "" : "s"}
              </span>
              {ticket.last_message_at && (
                <>
                  <span aria-hidden>·</span>
                  <span>{formatDate(ticket.last_message_at)}</span>
                </>
              )}
              {!!ticket.unread_count && ticket.unread_count > 0 && (
                <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                  {ticket.unread_count} new
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <Button onClick={onCreate} className="w-full">
          <IconPlus className="size-4" />
          Create ticket
        </Button>
      </div>
    </div>
  );
}

// ─── Ticket form ────────────────────────────────────────────────────────────────

function TicketForm({
  subject,
  message,
  sending,
  error,
  onSubjectChange,
  onMessageChange,
  onSubmit,
}: {
  subject: Subject | "";
  message: string;
  sending: boolean;
  error: string | null;
  onSubjectChange: (subject: Subject) => void;
  onMessageChange: (message: string) => void;
  onSubmit: () => void;
}) {
  const canSubmit = !!subject && message.trim().length > 0 && !sending;

  return (
    <div className="flex flex-col gap-4 p-4">
      {error && <ErrorBanner message={error} />}

      <div className="space-y-1.5">
        <label
          htmlFor="ticket-subject"
          className="text-sm font-medium text-foreground"
        >
          Subject
        </label>
        <Select
          value={subject}
          onValueChange={(value) => onSubjectChange(value as Subject)}
        >
          <SelectTrigger id="ticket-subject" className="w-full">
            <SelectValue placeholder="Choose a topic" />
          </SelectTrigger>
          <SelectContent>
            {SUBJECTS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="ticket-message"
          className="text-sm font-medium text-foreground"
        >
          How can we help?
        </label>
        <Textarea
          id="ticket-message"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="Describe your issue or question…"
          rows={5}
          className="resize-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </div>

      <Button
        onClick={onSubmit}
        disabled={!canSubmit}
        className="w-full"
      >
        <IconSend className="size-4" />
        {sending ? "Sending…" : "Send"}
      </Button>
    </div>
  );
}

// ─── Thread view ────────────────────────────────────────────────────────────────

function ThreadView({
  ticket,
  messages,
  loading,
  error,
  replying,
  onReply,
}: {
  ticket: Ticket;
  messages: Message[];
  loading: boolean;
  error: string | null;
  replying: boolean;
  onReply: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isResolved = ticket.status === "resolved";
  const canSend = draft.trim().length > 0 && !replying;

  // Keep the latest message in view as the thread loads or grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  function submit() {
    if (!canSend) return;
    onReply(draft);
    setDraft("");
  }

  return (
    <div className="flex h-104 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <StatusBadge status={ticket.status} />
        <span className="text-xs text-muted-foreground">
          Opened {formatDate(ticket.created_at)}
        </span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {loading &&
          [0, 1].map((i) => <Skeleton key={i} className="h-14 w-3/4 rounded-lg" />)}
        {!loading && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No messages to show.
          </p>
        )}
        {!loading &&
          messages.map((msg, index) => {
            const isCustomer = msg.author_type === "customer";
            // The opening message embeds the category prefix; hide it.
            const content = index === 0 ? stripCategory(msg.content) : msg.content;
            return (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col gap-0.5",
                  isCustomer ? "items-end" : "items-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap wrap-break-words",
                    isCustomer
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-muted text-foreground"
                  )}
                >
                  {content}
                </div>
                <span className="px-1 text-[10px] text-muted-foreground">
                  {msg.author_name ?? (isCustomer ? "You" : "Support")} ·{" "}
                  {formatDate(msg.created_at)}
                </span>
              </div>
            );
          })}
      </div>

      <div className="border-t border-border p-3">
        {error && (
          <div className="mb-2">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isResolved ? "Reply to reopen this ticket…" : "Write a reply…"
            }
            rows={1}
            className="max-h-28 min-h-9 flex-1 resize-none py-2"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send reply"
            className="size-9 shrink-0"
          >
            <IconSend className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared ─────────────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <IconAlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
