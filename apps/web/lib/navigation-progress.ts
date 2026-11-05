/**
 * State for the top-of-page loading bar (components/NavigationProgress.tsx).
 *
 * The App Router fetches the next page in the background, so the browser's own
 * loading indicator (Safari's blue bar, Chrome's tab spinner) never shows for
 * a link click. This bar stands in for it. `startNavigation` runs from
 * instrumentation-client.ts the moment a navigation starts; the component calls
 * `finishNavigation` once the new URL has rendered.
 */

export type NavigationProgressState = { visible: boolean; progress: number };

/** Navigations faster than this never show the bar, so instant pages stay calm. */
const SHOW_AFTER_MS = 120;
const TRICKLE_EVERY_MS = 250;
/** The bar creeps towards this until the page arrives. */
const TRICKLE_LIMIT = 0.9;
const FADE_OUT_MS = 250;
/** A navigation that never lands (aborted, errored) must not leave the bar up. */
const GIVE_UP_AFTER_MS = 15_000;

const IDLE: NavigationProgressState = { visible: false, progress: 1 };

let state = IDLE;
let pending = false;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let trickleTimer: ReturnType<typeof setInterval> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: NavigationProgressState) {
  state = next;
  for (const listener of listeners) listener();
}

function clearTimers() {
  clearTimeout(showTimer);
  clearInterval(trickleTimer);
  clearTimeout(hideTimer);
  clearTimeout(giveUpTimer);
}

export function subscribeNavigationProgress(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNavigationProgress(): NavigationProgressState {
  return state;
}

export function getServerNavigationProgress(): NavigationProgressState {
  return IDLE;
}

export function startNavigation(url: string) {
  // Hash links and clicks on the current page change no rendered URL, so
  // nothing would ever finish the bar.
  const target = new URL(url, window.location.href);
  if (target.pathname === window.location.pathname && target.search === window.location.search) return;

  clearTimers();
  pending = true;
  // Reset while hidden: the bar has no transform transition when invisible.
  set({ visible: false, progress: 0.08 });
  showTimer = setTimeout(() => {
    set({ visible: true, progress: state.progress });
    trickleTimer = setInterval(() => {
      set({ visible: true, progress: state.progress + (TRICKLE_LIMIT - state.progress) * 0.1 });
    }, TRICKLE_EVERY_MS);
  }, SHOW_AFTER_MS);
  giveUpTimer = setTimeout(finishNavigation, GIVE_UP_AFTER_MS);
}

export function finishNavigation() {
  if (!pending) return;
  pending = false;
  const wasVisible = state.visible;
  clearTimers();
  if (!wasVisible) {
    set(IDLE);
    return;
  }
  set({ visible: true, progress: 1 });
  hideTimer = setTimeout(() => set(IDLE), FADE_OUT_MS);
}
