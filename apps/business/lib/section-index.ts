/**
 * The section a path belongs to: the first three segments under /dashboard
 * (`/dashboard/<area>/<page>`), or `/dashboard` itself. After a hotel switch a
 * detail page of the old hotel ("/dashboard/bookings/reservations/abc") has no
 * meaning for the new one, so we land on its list.
 */
export function sectionIndex(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "dashboard") return "/dashboard";
  return "/" + segments.slice(0, 3).join("/");
}

/** Only same-origin paths under /dashboard are accepted; anything else is /dashboard. */
export function safeReturnTo(returnTo: string): string {
  if (typeof returnTo !== "string") return "/dashboard";
  // Reject protocol-relative, backslash tricks, and control characters.
  if (/[\\\u0000-\u001f]/.test(returnTo)) return "/dashboard";
  let path: string;
  try {
    const u = new URL(returnTo, "http://internal.invalid");
    if (u.origin !== "http://internal.invalid") return "/dashboard";
    path = u.pathname;
  } catch {
    return "/dashboard";
  }
  if (path !== "/dashboard" && !path.startsWith("/dashboard/")) return "/dashboard";
  return path;
}
