/**
 * Remembers on this device whether the visitor was signed in last time, so the
 * nav's top-right corner can show the right thing before the session check
 * returns. Pages are cached at Cloudflare and identical for everyone, so the
 * server cannot know; on a slow connection the corner used to stay blank.
 *
 * Only a yes/no and the initials are stored: on a shared device the next
 * person may briefly see them, and nothing more should leak that way.
 */

const NAV_HINT_KEY = "ob_nav_hint";

type NavHint = { signedIn: boolean; initials?: string };

export function writeNavHint(hint: NavHint) {
  try {
    localStorage.setItem(NAV_HINT_KEY, JSON.stringify(hint));
  } catch {
    // Storage blocked: the corner falls back to the sign-in button.
  }
}

/**
 * Runs in <head>, before first paint and before any JavaScript bundle, so the
 * placeholder is right even on a very slow load. It only sets an attribute and
 * a CSS variable on <html>; globals.css (`.nav-hint-*`) does the rest.
 * Initials are reduced to two letters or digits before they reach CSS.
 */
export const NAV_HINT_SCRIPT = `try{var h=JSON.parse(localStorage.getItem(${JSON.stringify(NAV_HINT_KEY)})||"null");if(h&&h.signedIn){var d=document.documentElement,i=String(h.initials||"").replace(/[^\\p{L}\\p{N}]/gu,"").slice(0,2)||"?";d.setAttribute("data-nav-hint","in");d.style.setProperty("--nav-initials",JSON.stringify(i))}}catch(e){}`;
