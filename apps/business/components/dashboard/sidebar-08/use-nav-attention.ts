"use client";

import { useCallback, useSyncExternalStore } from "react";

export type FeedEntry = {
  id: number;
  title: string;
  body: string;
  date: string;
};

// Stub feeds until the notifications backend lands. Newest first; `id` is the
// ordering key the seen-state compares against.
export const NOTIFICATIONS: FeedEntry[] = [
  {
    id: 3,
    title: "New reservation",
    body: "A booking came in for the Garden Suite, 12–15 October.",
    date: "2026-09-05",
  },
  {
    id: 2,
    title: "Payout on its way",
    body: "Your September payout has been sent to your bank account.",
    date: "2026-09-02",
  },
  {
    id: 1,
    title: "Review received",
    body: "A guest left a 5-star review for the Garden Suite.",
    date: "2026-08-28",
  },
];

export const CHANGELOG: FeedEntry[] = [
  {
    id: 2,
    title: "Rates & availability calendar",
    body: "Drag across dates to update pricing and availability in one pass.",
    date: "2026-09-04",
  },
  {
    id: 1,
    title: "Refreshed dashboard navigation",
    body: "The sidebar now collapses to an icon rail and remembers your place.",
    date: "2026-08-20",
  },
];

export type AttentionKey = "notifications" | "whatsNew";

const STORAGE_KEY = "ob:nav-seen";

type SeenState = Partial<Record<AttentionKey, number>>;

function readSeen(): SeenState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SeenState) : {};
  } catch {
    return {};
  }
}

// The seen state lives in localStorage, so it is an external store: a cached
// snapshot keeps `getSnapshot` referentially stable between writes.
const EMPTY_SEEN: SeenState = {};
let cachedSeen: SeenState | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function getSeenSnapshot(): SeenState {
  if (cachedSeen === null) cachedSeen = readSeen();
  return cachedSeen;
}

function getServerSeenSnapshot(): SeenState {
  return EMPTY_SEEN;
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  // Another tab marking things seen should clear the dot here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cachedSeen = null;
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

function countUnread(entries: FeedEntry[], lastSeenId: number | undefined) {
  return entries.filter((entry) => entry.id > (lastSeenId ?? 0)).length;
}

/**
 * Attention state for the secondary sidebar items. Counts are zero on the
 * server and during hydration; the stored state takes over right after.
 */
export function useNavAttention() {
  const seen = useSyncExternalStore(
    subscribe,
    getSeenSnapshot,
    getServerSeenSnapshot,
  );

  const markSeen = useCallback((key: AttentionKey) => {
    const entries = key === "notifications" ? NOTIFICATIONS : CHANGELOG;
    const latestId = entries.reduce((max, entry) => Math.max(max, entry.id), 0);
    const current = getSeenSnapshot();
    if ((current[key] ?? 0) >= latestId) return;

    const next = { ...current, [key]: latestId };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A full or blocked store just means the dot comes back next visit.
    }
    cachedSeen = next;
    emit();
  }, []);

  return {
    counts: {
      notifications: countUnread(NOTIFICATIONS, seen.notifications),
      whatsNew: countUnread(CHANGELOG, seen.whatsNew),
      // No support signal yet — the slot exists so a real one (an open ticket,
      // say) can light up the dot without touching the sidebar.
      support: 0,
    },
    markSeen,
  };
}
