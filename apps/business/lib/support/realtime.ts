/**
 * Minimal ActionCable client for Chatwoot's contact websocket (`/cable`,
 * RoomChannel, keyed by the contact's pubsub token). One connection per
 * signed-in user, owned by the support provider. Browser-only.
 *
 * Reconnects with backoff, treats a missing server ping as a dead socket,
 * and reports every reconnect so the open chat can refetch and merge.
 */

export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "closed";

export type RealtimeEvent = { event: string; data: Record<string, unknown> };

type Options = {
  url: string;
  pubsubToken: string;
  onEvent: (event: RealtimeEvent) => void;
  onStatus: (status: RealtimeStatus) => void;
  /** After a successful re-subscribe (not the first one). */
  onReconnect: () => void;
};

const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];
/** Chatwoot pings every 3 s; three missed pings means the socket is gone. */
const STALE_AFTER_MS = 10_000;

export function connectRealtime(opts: Options): { close: () => void } {
  const identifier = JSON.stringify({ channel: "RoomChannel", pubsub_token: opts.pubsubToken });
  let socket: WebSocket | null = null;
  let attempt = 0;
  let everConfirmed = false;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;

  const armStaleTimer = () => {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => socket?.close(), STALE_AFTER_MS);
  };

  const scheduleReconnect = () => {
    if (closed) return;
    opts.onStatus("reconnecting");
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
    attempt++;
    retryTimer = setTimeout(open, delay);
  };

  function open() {
    if (closed) return;
    opts.onStatus(everConfirmed ? "reconnecting" : "connecting");
    try {
      socket = new WebSocket(opts.url);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.onmessage = (event) => {
      let frame: { type?: string; identifier?: string; message?: unknown; reconnect?: boolean };
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      armStaleTimer();
      switch (frame.type) {
        case "welcome":
          socket?.send(JSON.stringify({ command: "subscribe", identifier }));
          return;
        case "ping":
          return;
        case "confirm_subscription": {
          const reconnected = everConfirmed;
          everConfirmed = true;
          attempt = 0;
          opts.onStatus("live");
          if (reconnected) opts.onReconnect();
          return;
        }
        case "reject_subscription":
          // A bad or revoked token won't get better by retrying.
          closed = true;
          opts.onStatus("closed");
          socket?.close();
          return;
        case "disconnect":
          if (frame.reconnect === false) {
            closed = true;
            opts.onStatus("closed");
          }
          socket?.close();
          return;
      }
      if (frame.identifier !== identifier) return;
      const message = frame.message as { event?: unknown; data?: unknown } | undefined;
      if (typeof message?.event === "string" && message.data && typeof message.data === "object") {
        opts.onEvent({ event: message.event, data: message.data as Record<string, unknown> });
      }
    };

    socket.onclose = () => {
      clearTimeout(staleTimer);
      socket = null;
      scheduleReconnect();
    };
    socket.onerror = () => socket?.close();
  }

  open();

  return {
    close() {
      closed = true;
      clearTimeout(retryTimer);
      clearTimeout(staleTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      opts.onStatus("closed");
    },
  };
}

/** The conversation id an event belongs to, across Chatwoot's payload shapes. */
export function eventConversationId(event: RealtimeEvent): number | null {
  const d = event.data;
  if (event.event.startsWith("message.")) {
    return typeof d.conversation_id === "number" ? d.conversation_id : null;
  }
  if (event.event.startsWith("conversation.typing")) {
    const conversation = d.conversation as { id?: unknown } | undefined;
    return typeof conversation?.id === "number" ? conversation.id : null;
  }
  return typeof d.id === "number" ? d.id : null;
}
