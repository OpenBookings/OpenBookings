"use client";

import { useEffect, useSyncExternalStore } from "react";
import { BACKDROP_COOKIE, pickBackdrop, type Backdrop } from "./backdrops";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Earlier versions remembered the backdrop in localStorage and copied the
// image into the Cache API. Both are replaced by the cookie.
const LEGACY_STORAGE_KEY = "ob_backgrounds";
const LEGACY_CACHES = ["ob_backgrounds", "openbookings-backgrounds"];

// The id picked in this tab, for when the cookie cannot be written (blocked
// cookies): the visitor still gets a photo, just a new one each visit.
let pickedThisTab: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readStoredId(): string | null {
  const prefix = `${BACKDROP_COOKIE}=`;
  for (const part of document.cookie.split(";")) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) {
      try {
        return decodeURIComponent(entry.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return pickedThisTab;
}

function rememberBackdrop(id: string) {
  pickedThisTab = id;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${BACKDROP_COOKIE}=${encodeURIComponent(id)}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax${secure}`;

  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing to clean up.
  }
  if (typeof caches !== "undefined") {
    for (const name of LEGACY_CACHES) void caches.delete(name).catch(() => {});
  }
  for (const listener of listeners) listener();
}

/**
 * The visitor's backdrop, picked in the browser from the id in their cookie.
 *
 * Picking here rather than on the server keeps the page's HTML the same for
 * every visitor, so the CDN can cache it. The cost is that the photo appears
 * just after the page does: the server render (and the first browser render,
 * which must match it) has no backdrop.
 */
export function useBackdrop(list: readonly Backdrop[]): Backdrop | null {
  const storedId = useSyncExternalStore(subscribe, readStoredId, () => null);
  const known = storedId ? (list.find((b) => b.id === storedId) ?? null) : null;

  useEffect(() => {
    if (known || list.length === 0) return;
    const { backdrop } = pickBackdrop(list, null);
    if (backdrop) rememberBackdrop(backdrop.id);
  }, [known, list]);

  return known;
}

/**
 * For server-rendered pages that pick the backdrop from the cookie themselves:
 * stores a freshly picked id so the next visit shows the same photo. Render it
 * only when `getBackdrop` returned `persist: true`. It renders nothing.
 */
export function RememberBackdrop({ id }: { id: string }) {
  useEffect(() => {
    rememberBackdrop(id);
  }, [id]);

  return null;
}
