"use client";

import { useEffect, useState } from "react";
import { resolveBackdrop, type Backdrop } from "@openbookings/images";

const STORAGE_KEY = "ob_backgrounds";
// Earlier versions copied each backdrop into the Cache API and rendered a
// blob URL. The HTTP cache already does that job, so the copies are dropped.
const LEGACY_CACHES = ["ob_backgrounds", "openbookings-backgrounds"];

/**
 * The visitor's backdrop, chosen once and remembered. Null on the server and
 * on first render, because the choice is random and must not differ between
 * the server's HTML and the browser's.
 */
export function useBackdrop(): Backdrop | null {
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);

  useEffect(() => {
    function load() {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch {
        // Storage blocked: fall through and pick without remembering.
      }
      const resolved = resolveBackdrop(stored);
      if (resolved.changed) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(resolved.backdrop));
        } catch {
          // Not remembered; a different backdrop next visit is harmless.
        }
      }
      setBackdrop(resolved.backdrop);

      if (typeof caches !== "undefined") {
        for (const name of LEGACY_CACHES) void caches.delete(name).catch(() => {});
      }
    }
    load();
  }, []);

  return backdrop;
}
