'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TURNSTILE_ACTION } from './turnstile';

/**
 * Mints a Turnstile token for the checkout surface.
 *
 * Explicit render rather than the `class="cf-turnstile"` auto-render, because
 * this page outlives its submissions. A token is redeemed exactly once at
 * siteverify, so the retry path needs a *fresh* one — which means holding this
 * widget's own id and calling `turnstile.reset(id)` on it. Auto-render gives
 * no id back, so there would be nothing to reset.
 *
 * The sitekey is public by design — it ships in the page for the browser to
 * read. Only `TURNSTILE_SECRET`, on the server, is confidential.
 */

/** The widget registered for this project. Public. */
const SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '0x4AAAAAACgQ1RzP_I4Cne2S';

const SCRIPT_ID = 'cf-turnstile-api';
const ONLOAD_CALLBACK = '__cfTurnstileOnLoad';
const SCRIPT_SRC = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${ONLOAD_CALLBACK}`;

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      callback?: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      'timeout-callback'?: () => void;
      theme?: 'light' | 'dark' | 'auto';
      appearance?: 'always' | 'execute' | 'interaction-only';
    }
  ): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    [ONLOAD_CALLBACK]?: () => void;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/**
 * Loads api.js once per page and resolves when `window.turnstile` is ready.
 *
 * Cached in a module-level promise: React strict mode mounts effects twice in
 * development, and two concurrent callers must share one script tag rather
 * than race to append a second.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }

    window[ONLOAD_CALLBACK] = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile loaded without an API'));
    };

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      // Let a later attempt re-add the tag; a blocked CDN is often transient.
      scriptPromise = null;
      reject(new Error('Turnstile script failed to load'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export type TurnstileState = {
  /** A fresh, unspent token, or null while one is being minted. */
  token: string | null;
  /** The challenge could not complete — script blocked, or the widget errored. */
  failed: boolean;
  /** Where the widget mounts. Must stay in the DOM for `reset` to work. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Discard the current token and mint another. Call before every retry. */
  reset: () => void;
};

export function useTurnstileToken(): TurnstileState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    loadTurnstile()
      .then((turnstile) => {
        if (!active || !containerRef.current) return;
        // Already rendered (strict-mode double effect); leave it alone rather
        // than stacking a second widget into the same container.
        if (widgetIdRef.current !== null) return;

        const id = turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          // Must match the action the route checks, or siteverify's response
          // is rejected server-side even though the challenge was solved.
          action: TURNSTILE_ACTION,
          theme: 'dark',
          callback: (issued: string) => {
            if (!active) return;
            setFailed(false);
            setToken(issued);
          },
          'error-callback': () => {
            if (active) setFailed(true);
          },
          // A token left unspent goes stale. Drop it and mint another rather
          // than sending one siteverify will reject.
          'expired-callback': () => {
            if (!active) return;
            setToken(null);
            if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
          },
          'timeout-callback': () => {
            if (active) setFailed(true);
          },
        });

        widgetIdRef.current = id ?? null;
        if (id === undefined) setFailed(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      if (id) window.turnstile?.remove(id);
    };
  }, []);

  const reset = useCallback(() => {
    setToken(null);
    setFailed(false);
    const id = widgetIdRef.current;
    if (id) window.turnstile?.reset(id);
  }, []);

  return { token, failed, containerRef, reset };
}
