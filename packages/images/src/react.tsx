"use client";

import { useEffect } from "react";
import { BACKDROP_COOKIE } from "./backdrops";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Earlier versions remembered the backdrop in localStorage and copied the
// image into the Cache API. Both are replaced by the cookie.
const LEGACY_STORAGE_KEY = "ob_backgrounds";
const LEGACY_CACHES = ["ob_backgrounds", "openbookings-backgrounds"];

/**
 * Stores a freshly picked backdrop id in a cookie, so the server renders the
 * same photo on the next visit. Render it only when `getBackdrop` returned
 * `persist: true`. It renders nothing.
 */
export function RememberBackdrop({ id }: { id: string }) {
  useEffect(() => {
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
  }, [id]);

  return null;
}
