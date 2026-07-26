"use client";

/**
 * Client entry (`@openbookings/messaging/client`) — safe to import from
 * client components; must not pull in the server entry (db, node:crypto).
 */
import * as React from "react";
import type { ThreadMessage } from "./types";

export type { MessageRow, ThreadListItem, ThreadMessage } from "./types";

const POLL_INTERVAL_MS = 5000;
const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 8000;

function realtimeWsUrl(): string {
  const base = process.env.NEXT_PUBLIC_REALTIME_WORKER_URL ?? "";
  return base.replace(/^http/, "ws");
}

function dedupeAndSort(prev: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Full client-side state machine for one open thread, shared by the host
 * dashboard (apps/business) and the guest inbox (apps/web): initial page
 * load, live updates over a WebSocket to the user's Durable Object with
 * jittered-backoff reconnect and a polling fallback while disconnected,
 * marking incoming messages read, and sending.
 *
 * `selfRole` is which side of the thread the current user is on — it decides
 * which messages count as incoming for the mark-read pass.
 */
export function useThreadMessages({
  threadId,
  currentUserId,
  selfRole,
}: {
  threadId: string;
  currentUserId: string;
  selfRole: "host" | "guest";
}) {
  const [messages, setMessages] = React.useState<ThreadMessage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [live, setLive] = React.useState(true);

  // Initial page load.
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    fetch(`/api/threads/${threadId}/messages`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setMessages(data.messages ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Kept in sync with `messages` so the polling fallback below can read the
  // latest cursor without retriggering the WebSocket effect on every message.
  const messagesRef = React.useRef<ThreadMessage[]>(messages);
  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Live updates via a WebSocket to the recipient's Durable Object, falling
  // back to periodic refetch while disconnected. WebSocket has no built-in
  // reconnect (unlike EventSource), so that's handled explicitly here with
  // jittered exponential backoff.
  React.useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectAttempt = 0;
    let pollId: ReturnType<typeof setInterval> | undefined;

    const stopPolling = () => {
      if (pollId) clearInterval(pollId);
      pollId = undefined;
    };

    const startPolling = () => {
      setLive(false);
      if (pollId) return;
      pollId = setInterval(() => {
        const since = messagesRef.current.at(-1)?.id;
        const url = since
          ? `/api/threads/${threadId}/messages?since=${since}`
          : `/api/threads/${threadId}/messages`;
        fetch(url)
          .then((res) => res.json())
          .then((data) => {
            if (data.messages?.length) setMessages((prev) => dedupeAndSort(prev, data.messages));
          })
          .catch(() => {});
      }, POLL_INTERVAL_MS);
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      startPolling();
      const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** reconnectAttempt, WS_RECONNECT_MAX_MS);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, jitter);
    };

    const connect = async () => {
      if (cancelled) return;
      try {
        // Short-lived (60s) token, re-requested per connection attempt
        // rather than reused across reconnects.
        const res = await fetch("/api/realtime/token", { method: "POST" });
        if (!res.ok) throw new Error("token request failed");
        const { token } = await res.json();
        if (cancelled) return;

        ws = new WebSocket(`${realtimeWsUrl()}/connect?token=${encodeURIComponent(token)}`);

        ws.onopen = () => {
          reconnectAttempt = 0;
          setLive(true);
          stopPolling();
        };
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === "message") setMessages((prev) => dedupeAndSort(prev, [payload.message]));
          } catch {
            // ignore malformed events
          }
        };
        ws.onclose = () => {
          if (!cancelled) scheduleReconnect();
        };
        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPolling();
      ws?.close();
    };
  }, [threadId]);

  // Mark incoming (not-yet-read) messages as read while the thread is open.
  React.useEffect(() => {
    const unread = messages.filter(
      (m) => m.sender_role !== selfRole && !m.read_at && m.sender_id !== currentUserId,
    );
    if (unread.length === 0) return;
    unread.forEach((m) => {
      fetch(`/api/messages/${m.id}/read`, { method: "PATCH" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data?.message) return;
          setMessages((prev) => prev.map((x) => (x.id === m.id ? data.message : x)));
        })
        .catch(() => {});
    });
  }, [messages, currentUserId, selfRole]);

  /** Sends a message; resolves true when it was accepted (so the caller can clear its input). */
  const send = React.useCallback(
    async (body: string): Promise<boolean> => {
      const trimmed = body.trim();
      if (!trimmed || sending) return false;
      setSending(true);
      setWarning(null);
      try {
        const res = await fetch(`/api/threads/${threadId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: trimmed }),
        });
        const data = await res.json();
        if (!res.ok) {
          setWarning(data.error ?? "Failed to send message.");
          return false;
        }
        setMessages((prev) => dedupeAndSort(prev, [data.message]));
        if (data.warning) setWarning(data.warning);
        return true;
      } catch {
        setWarning("Failed to send message. Check your connection.");
        return false;
      } finally {
        setSending(false);
      }
    },
    [threadId, sending],
  );

  return { messages, loading, live, sending, warning, send };
}
