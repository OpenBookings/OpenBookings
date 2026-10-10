const HINT_KEY = "ob-passkey-on-device";

type HintStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage, or null where the browser withholds it (private mode, blocked site data). */
function browserStore(): HintStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether this browser has used or enrolled a passkey here before. A browser
 * will not say whether a passkey exists without showing its own dialog, so
 * the login page uses this to decide whether opening that dialog unasked is
 * welcome. It is a UX hint only — never evidence of anything.
 */
export function hasPasskeyHint(store: HintStore | null = browserStore()): boolean {
  try {
    return store?.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberPasskey(store: HintStore | null = browserStore()): void {
  try {
    store?.setItem(HINT_KEY, "1");
  } catch {
    // Without storage the login page simply never prompts unasked.
  }
}

export function forgetPasskey(store: HintStore | null = browserStore()): void {
  try {
    store?.removeItem(HINT_KEY);
  } catch {
    // Nothing stored, nothing to forget.
  }
}
