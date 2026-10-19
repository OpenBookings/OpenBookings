"use client";

import * as React from "react";
import { toast } from "sonner";
import { usePostHog } from "@openbookings/analytics/client";
import {
  loadTicketAction,
  markSeenAction,
  refreshPanelAction,
  requestPersonAction,
  resolveTicketAction,
  setTypingAction,
} from "@/lib/support/actions";
import { findCategory } from "@/lib/support/categories";
import { mapChatwootMessage, mergeMessages, type ChatMessage, type RawChatwootMessage } from "@/lib/support/chat";
import { connectRealtime, eventConversationId, type RealtimeEvent, type RealtimeStatus } from "@/lib/support/realtime";
import { ticketRef } from "@/lib/support/references";
import type { TicketStatus } from "@/lib/support/status";
import type { LinkOption, SupportBootstrap, TicketDetail, TicketSummary, TicketWithMessages } from "@/lib/support/types";

/**
 * Host support, client side: the panel's open state and view, one websocket
 * per signed-in user, and the state of every chat opened this session.
 * Mounted once in the dashboard layout, so the panel survives navigation and
 * a chat keeps its state while the panel is closed.
 */

export type IntakePreset = {
  category?: string;
  linked?: LinkOption | null;
  /** Opened from a contextual "Get help": category and item are fixed. */
  locked?: boolean;
  followUpOf?: string | null;
};

export type IntakeDraft = {
  category: string;
  linked: LinkOption | null;
  message: string;
  files: File[];
  followUpOf: string | null;
  locked: boolean;
};

export type PanelView =
  | { name: "home" }
  | { name: "creating"; draft: IntakeDraft; optimistic: ChatMessage }
  | { name: "chat"; ticketId: string };

/** The new-ticket dialog. `key` remounts it, so every open starts fresh. */
export type IntakeState = { key: number; preset?: IntakePreset; draft?: IntakeDraft; error?: string };

export type ChatState = {
  /** Null only when the first load failed (see `error`). */
  ticket: TicketDetail | null;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  botTyping: boolean;
  personTyping: string | null;
  /** When the host last wrote, for the silent-assistant rule. */
  lastHostAt: number | null;
};

type OpenTarget = { ticketId: string } | { newTicket: IntakePreset };

type SupportContextValue = {
  assistantEnabled: boolean;
  hours: SupportBootstrap["hours"];
  appOrigin: string | null;
  open: boolean;
  view: PanelView;
  openTickets: TicketSummary[];
  /** Any of your tickets has a reply you haven't seen. */
  hasUnread: boolean;
  connection: RealtimeStatus | "off";
  chats: Record<string, ChatState>;
  openPanel: (target?: OpenTarget) => void;
  closePanel: () => void;
  /** Null while the new-ticket dialog is closed. */
  intake: IntakeState | null;
  openIntake: (preset?: IntakePreset) => void;
  closeIntake: () => void;
  setView: (view: PanelView) => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  loadChat: (ticketId: string) => Promise<void>;
  sendMessage: (ticketId: string, content: string, files: File[]) => Promise<boolean>;
  retryMessage: (ticketId: string, key: string) => void;
  submitTicket: (draft: IntakeDraft) => Promise<void>;
  resolveTicket: (ticketId: string) => Promise<boolean>;
  requestPerson: (ticketId: string, reason: "asked" | "not_answered") => Promise<void>;
  notifyTyping: (ticketId: string) => void;
  markSeen: (ticketId: string) => void;
  /** Called after anything that changes the ticket list (for /support). */
  onTicketsChanged: (listener: () => void) => () => void;
};

const SupportContext = React.createContext<SupportContextValue | null>(null);

export function useSupport(): SupportContextValue {
  const value = React.useContext(SupportContext);
  if (!value) throw new Error("useSupport needs a SupportProvider");
  return value;
}

/** Null outside the provider — for entry points that also render when support is off. */
export function useOptionalSupport(): SupportContextValue | null {
  return React.useContext(SupportContext);
}

function newKey() {
  return `tmp:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
}

function optimisticMessage(content: string, files: File[]): ChatMessage {
  return {
    key: newKey(),
    chatwootId: null,
    kind: "host",
    content,
    createdAt: Date.now(),
    senderName: null,
    attachments: files.map((file, i) => ({
      id: -1 - i,
      kind: file.type.startsWith("image/") ? "image" : "file",
      url: "",
      thumbUrl: null,
      name: file.name,
      size: file.size,
    })),
    state: "sending",
  };
}

async function postForm<T>(url: string, form: FormData): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "POST", body: form });
    const json = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: string } | null;
    if (json?.ok) return { ok: true, data: json.data as T };
    return { ok: false, error: json?.error ?? "Something went wrong. Please try again." };
  } catch {
    return { ok: false, error: "You seem to be offline. Please try again." };
  }
}

function applyStatus(ticket: TicketDetail, status: TicketStatus): TicketDetail {
  const now = new Date().toISOString();
  return {
    ...ticket,
    status,
    handedOffAt:
      ticket.handedOffAt ?? ((status === "open" || status === "snoozed") && ticket.status === "pending" ? now : null),
    resolvedAt: status === "resolved" ? now : ticket.resolvedAt,
  };
}

const TYPING_REFRESH_MS = 3000;
const TYPING_IDLE_MS = 2500;

export function SupportProvider({
  bootstrap,
  children,
}: {
  bootstrap: SupportBootstrap;
  children: React.ReactNode;
}) {
  const posthog = usePostHog();
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<PanelView>({ name: "home" });
  const [intake, setIntake] = React.useState<IntakeState | null>(null);
  const [openTickets, setOpenTickets] = React.useState(bootstrap.openTickets);
  const [serverUnread, setServerUnread] = React.useState(bootstrap.unreadCount);
  const [localUnread, setLocalUnread] = React.useState<Set<number>>(() => new Set());
  const [pubsubToken, setPubsubToken] = React.useState(bootstrap.pubsubToken);
  const [connection, setConnection] = React.useState<RealtimeStatus | "off">("off");
  const [chats, setChats] = React.useState<Record<string, ChatState>>({});
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  // Latest values for callbacks that outlive a render (websocket, timers).
  const state = React.useRef({ open, view, chats, openTickets });
  React.useLayoutEffect(() => {
    state.current = { open, view, chats, openTickets };
  });

  const listeners = React.useRef(new Set<() => void>());
  const emitChanged = React.useCallback(() => {
    for (const listener of listeners.current) listener();
  }, []);
  const onTicketsChanged = React.useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const updateChat = React.useCallback((ticketId: string, fn: (chat: ChatState) => ChatState) => {
    setChats((prev) => (prev[ticketId] ? { ...prev, [ticketId]: fn(prev[ticketId]) } : prev));
  }, []);

  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshPanel = React.useCallback(() => {
    clearTimeout(refreshTimer.current);
    // Give the support webhook a moment to land before re-reading the list.
    refreshTimer.current = setTimeout(async () => {
      const result = await refreshPanelAction();
      if (!result.ok) return;
      setOpenTickets(result.data.openTickets);
      setServerUnread(result.data.unreadCount);
      if (result.data.pubsubToken) setPubsubToken(result.data.pubsubToken);
      emitChanged();
    }, 1200);
  }, [emitChanged]);

  const ticketIdForConversation = React.useCallback((conversationId: number): string | null => {
    const { chats, openTickets } = state.current;
    const fromChat = Object.values(chats).find((c) => c.ticket?.reference === conversationId);
    if (fromChat?.ticket) return fromChat.ticket.id;
    return openTickets.find((t) => t.reference === conversationId)?.id ?? null;
  }, []);

  // ── Opening and closing ──────────────────────────────────────────────────

  // The dialog takes over from the panel: one support surface at a time.
  const openIntake = React.useCallback((preset?: IntakePreset) => {
    if (document.activeElement instanceof HTMLElement) returnFocusRef.current = document.activeElement;
    setIntake({ key: Date.now(), preset });
    setOpen(false);
  }, []);

  const closeIntake = React.useCallback(() => setIntake(null), []);

  const openPanel = React.useCallback(
    (target?: OpenTarget) => {
      if (target && "newTicket" in target) {
        openIntake(target.newTicket);
        return;
      }
      if (document.activeElement instanceof HTMLElement) returnFocusRef.current = document.activeElement;
      if (target && "ticketId" in target) setView({ name: "chat", ticketId: target.ticketId });
      else {
        // Home only exists to stop duplicate tickets: with none open, go straight to the intake.
        const current = state.current.view;
        const keep = state.current.open || current.name === "chat" || current.name === "creating";
        if (!keep && state.current.openTickets.length === 0) {
          openIntake();
          return;
        }
        if (!keep) setView({ name: "home" });
      }
      setIntake(null);
      setOpen(true);
    },
    [openIntake],
  );

  const closePanel = React.useCallback(() => setOpen(false), []);

  // ── Chats ────────────────────────────────────────────────────────────────

  const acceptTicket = React.useCallback((data: TicketWithMessages) => {
    setChats((prev) => {
      const existing = prev[data.ticket.id];
      return {
        ...prev,
        [data.ticket.id]: {
          ticket: data.ticket,
          // Keep optimistic and failed copies across a refetch.
          messages: mergeMessages(
            existing?.messages.filter((m) => m.chatwootId === null) ?? [],
            data.messages,
          ),
          loading: false,
          error: null,
          botTyping: existing?.botTyping ?? false,
          personTyping: existing?.personTyping ?? null,
          lastHostAt:
            [...data.messages].reverse().find((m) => m.kind === "host")?.createdAt ?? existing?.lastHostAt ?? null,
        },
      };
    });
  }, []);

  const loadChat = React.useCallback(
    async (ticketId: string) => {
      setChats((prev) =>
        prev[ticketId] ? { ...prev, [ticketId]: { ...prev[ticketId], loading: !prev[ticketId].messages.length } } : prev,
      );
      const result = await loadTicketAction(ticketId);
      if (result.ok) {
        acceptTicket(result.data);
      } else {
        setChats((prev) => ({
          ...prev,
          [ticketId]: prev[ticketId]
            ? { ...prev[ticketId], loading: false, error: result.error }
            : {
                ticket: null,
                messages: [],
                loading: false,
                error: result.error,
                botTyping: false,
                personTyping: null,
                lastHostAt: null,
              },
        }));
      }
    },
    [acceptTicket],
  );

  const pendingSends = React.useRef(new Map<string, { content: string; files: File[] }>());

  const deliver = React.useCallback(
    async (ticketId: string, message: ChatMessage, content: string, files: File[]) => {
      const form = new FormData();
      form.set("content", content);
      for (const file of files) form.append("files", file);
      const result = await postForm<ChatMessage>(`/api/support/tickets/${encodeURIComponent(ticketId)}/messages`, form);
      if (result.ok) {
        pendingSends.current.delete(message.key);
        updateChat(ticketId, (chat) => ({
          ...chat,
          messages: mergeMessages(
            chat.messages.filter((m) => m.key !== message.key),
            [result.data],
          ),
        }));
        emitChanged();
        return true;
      }
      updateChat(ticketId, (chat) => ({
        ...chat,
        error: result.error,
        messages: chat.messages.map((m) => (m.key === message.key ? { ...m, state: "failed" } : m)),
      }));
      return false;
    },
    [emitChanged, updateChat],
  );

  const sendMessage = React.useCallback(
    async (ticketId: string, content: string, files: File[]) => {
      const message = optimisticMessage(content, files);
      pendingSends.current.set(message.key, { content, files });
      updateChat(ticketId, (chat) => ({
        ...chat,
        error: null,
        lastHostAt: message.createdAt,
        messages: [...chat.messages, message],
      }));
      return deliver(ticketId, message, content, files);
    },
    [deliver, updateChat],
  );

  const retryMessage = React.useCallback(
    (ticketId: string, key: string) => {
      const pending = pendingSends.current.get(key);
      const chat = state.current.chats[ticketId];
      const message = chat?.messages.find((m) => m.key === key);
      if (!pending || !message) return;
      updateChat(ticketId, (c) => ({
        ...c,
        error: null,
        messages: c.messages.map((m) => (m.key === key ? { ...m, state: "sending" } : m)),
      }));
      void deliver(ticketId, message, pending.content, pending.files);
    },
    [deliver, updateChat],
  );

  const submitTicket = React.useCallback(
    async (draft: IntakeDraft) => {
      const category = findCategory(draft.category);
      const optimistic = optimisticMessage(draft.message.trim() || category?.label || "", draft.files);
      // Hand over to the panel, which shows the chat as it's created.
      setIntake(null);
      setView({ name: "creating", draft, optimistic });
      setOpen(true);

      const form = new FormData();
      form.set("category", draft.category);
      if (draft.linked) {
        form.set("linkedType", draft.linked.type);
        form.set("linkedId", draft.linked.id);
      }
      form.set("message", draft.message);
      if (draft.followUpOf) form.set("followUpOf", draft.followUpOf);
      form.set("route", window.location.pathname);
      if (category?.attachReplay) {
        try {
          const replay = posthog?.get_session_replay_url?.({ withTimestamp: true });
          if (replay) form.set("replayUrl", replay);
        } catch {}
      }
      for (const file of draft.files) form.append("files", file);

      const result = await postForm<TicketWithMessages & { pubsubToken: string }>("/api/support/tickets", form);
      if (!result.ok) {
        // Back to the dialog's review step, with everything typed intact.
        setOpen(false);
        setView({ name: "home" });
        setIntake({ key: Date.now(), draft, error: result.error });
        return;
      }
      const { pubsubToken: token, ...data } = result.data;
      acceptTicket(data);
      setChats((prev) => ({
        ...prev,
        [data.ticket.id]: { ...prev[data.ticket.id]!, lastHostAt: Date.now() },
      }));
      setPubsubToken((current) => current ?? token);
      setOpenTickets((prev) => [data.ticket, ...prev.filter((t) => t.id !== data.ticket.id)].slice(0, 3));
      setView((current) => (current.name === "creating" ? { name: "chat", ticketId: data.ticket.id } : current));
      emitChanged();
    },
    [acceptTicket, emitChanged, posthog],
  );

  const resolveTicket = React.useCallback(
    async (ticketId: string) => {
      const result = await resolveTicketAction(ticketId);
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      updateChat(ticketId, (chat) => ({ ...chat, ticket: chat.ticket && applyStatus(chat.ticket, "resolved") }));
      setOpenTickets((prev) => prev.filter((t) => t.id !== ticketId));
      emitChanged();
      return true;
    },
    [emitChanged, updateChat],
  );

  const requestPerson = React.useCallback(
    async (ticketId: string, reason: "asked" | "not_answered") => {
      const result = await requestPersonAction(ticketId, reason);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      updateChat(ticketId, (chat) => ({ ...chat, botTyping: false, ticket: chat.ticket && applyStatus(chat.ticket, "open") }));
      emitChanged();
    },
    [emitChanged, updateChat],
  );

  const typing = React.useRef<{ ticketId: string | null; sentAt: number; idle?: ReturnType<typeof setTimeout> }>({
    ticketId: null,
    sentAt: 0,
  });
  const notifyTyping = React.useCallback((ticketId: string) => {
    const t = typing.current;
    const now = Date.now();
    if (t.ticketId !== ticketId || now - t.sentAt > TYPING_REFRESH_MS) {
      t.ticketId = ticketId;
      t.sentAt = now;
      void setTypingAction(ticketId, true);
    }
    clearTimeout(t.idle);
    t.idle = setTimeout(() => {
      t.sentAt = 0;
      void setTypingAction(ticketId, false);
    }, TYPING_IDLE_MS);
  }, []);

  const seenTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const markSeen = React.useCallback(
    (ticketId: string) => {
      const chat = state.current.chats[ticketId];
      const reference = chat?.ticket?.reference;
      if (reference !== undefined) {
        setLocalUnread((prev) => {
          if (!prev.has(reference)) return prev;
          const next = new Set(prev);
          next.delete(reference);
          return next;
        });
        setOpenTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, unread: false } : t)));
      }
      clearTimeout(seenTimer.current);
      seenTimer.current = setTimeout(async () => {
        await markSeenAction(ticketId);
        refreshPanel();
      }, 800);
    },
    [refreshPanel],
  );

  // ── Realtime ─────────────────────────────────────────────────────────────

  const handleEvent = React.useCallback(
    (event: RealtimeEvent) => {
      const conversationId = eventConversationId(event);
      if (conversationId === null) return;
      const ticketId = ticketIdForConversation(conversationId);
      const { open, view } = state.current;
      const viewing = open && view.name === "chat" && view.ticketId === ticketId && document.visibilityState === "visible";

      switch (event.event) {
        case "message.created":
        case "message.updated": {
          const message = mapChatwootMessage(event.data as unknown as RawChatwootMessage);
          if (!message) return;
          if (ticketId) {
            updateChat(ticketId, (chat) => ({
              ...chat,
              messages: mergeMessages(chat.messages, [message]),
              ...(message.kind === "host" ? {} : { botTyping: false, personTyping: null }),
            }));
          }
          if (message.kind !== "host" && event.event === "message.created") {
            if (viewing && ticketId) {
              markSeen(ticketId);
            } else {
              setLocalUnread((prev) => new Set(prev).add(conversationId));
              if (!open) {
                toast(`New reply on ${ticketRef(conversationId)}`, {
                  action: {
                    label: "Open",
                    onClick: () => openPanel(ticketId ? { ticketId } : undefined),
                  },
                });
              }
            }
          }
          refreshPanel();
          return;
        }
        case "conversation.status_changed": {
          const status = event.data.status;
          if (status !== "pending" && status !== "open" && status !== "snoozed" && status !== "resolved") return;
          if (ticketId) {
            updateChat(ticketId, (chat) => ({
              ...chat,
              botTyping: false,
              personTyping: null,
              ticket: chat.ticket && applyStatus(chat.ticket, status),
            }));
          }
          refreshPanel();
          return;
        }
        case "conversation.typing_on":
        case "conversation.typing_off": {
          if (!ticketId || event.data.is_private === true) return;
          const user = (event.data.user ?? {}) as { type?: string; name?: string; available_name?: string };
          const isBot = (user.type ?? "").toLowerCase().replace(/[^a-z]/g, "") === "agentbot";
          const on = event.event === "conversation.typing_on";
          updateChat(ticketId, (chat) =>
            isBot
              ? { ...chat, botTyping: on }
              : { ...chat, personTyping: on ? user.available_name || user.name || "The support team" : null },
          );
          return;
        }
      }
    },
    [markSeen, openPanel, refreshPanel, ticketIdForConversation, updateChat],
  );

  const onRealtimeEvent = React.useEffectEvent(handleEvent);
  const onReconnect = React.useEffectEvent(() => {
    // Anything could have happened while we were away: refetch and merge.
    if (view.name === "chat") void loadChat(view.ticketId);
    refreshPanel();
  });

  React.useEffect(() => {
    if (!bootstrap.websocketUrl || !pubsubToken) return;
    const connection = connectRealtime({
      url: bootstrap.websocketUrl,
      pubsubToken,
      onEvent: (event) => onRealtimeEvent(event),
      onStatus: setConnection,
      onReconnect: () => onReconnect(),
    });
    return () => connection.close();
  }, [bootstrap.websocketUrl, pubsubToken]);

  const value = React.useMemo<SupportContextValue>(
    () => ({
      assistantEnabled: bootstrap.assistantEnabled,
      hours: bootstrap.hours,
      appOrigin: bootstrap.appOrigin,
      open,
      view,
      openTickets,
      hasUnread: serverUnread > 0 || localUnread.size > 0,
      connection,
      chats,
      openPanel,
      closePanel,
      intake,
      openIntake,
      closeIntake,
      setView,
      returnFocusRef,
      loadChat,
      sendMessage,
      retryMessage,
      submitTicket,
      resolveTicket,
      requestPerson,
      notifyTyping,
      markSeen,
      onTicketsChanged,
    }),
    [
      bootstrap.assistantEnabled,
      bootstrap.hours,
      bootstrap.appOrigin,
      open,
      view,
      openTickets,
      serverUnread,
      localUnread,
      connection,
      chats,
      openPanel,
      closePanel,
      intake,
      openIntake,
      closeIntake,
      loadChat,
      sendMessage,
      retryMessage,
      submitTicket,
      resolveTicket,
      requestPerson,
      notifyTyping,
      markSeen,
      onTicketsChanged,
    ],
  );

  return <SupportContext.Provider value={value}>{children}</SupportContext.Provider>;
}
