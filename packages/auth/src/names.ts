/**
 * First/last name helpers for social sign-in. `null` from a helper means
 * "do not touch names": the caller then returns no firstName/lastName keys,
 * so the `user_names_sync` trigger and any names the guest typed stay as they
 * are.
 *
 * Values are trimmed, runs of whitespace (NBSP included) collapse to one
 * space, and each is cut to 50 characters (the column limit) so an over-long
 * provider name never lands unbounded.
 */
export const MAX_NAME_LENGTH = 50;

export type Names = { firstName: string; lastName: string };

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH).trim();
}

/** The DB's legacy split rule: last token = last name, the rest = first name. */
export function splitFullName(full: unknown): Names {
  const text = typeof full === "string" ? full.replace(/\s+/g, " ").trim() : "";
  if (!text) return { firstName: "", lastName: "" };
  const at = text.lastIndexOf(" ");
  if (at === -1) return { firstName: clean(text), lastName: "" };
  return { firstName: clean(text.slice(0, at)), lastName: clean(text.slice(at + 1)) };
}

export function namesFromGoogle(p: { given_name?: string; family_name?: string; name?: string }): Names | null {
  const firstName = clean(p.given_name);
  const lastName = clean(p.family_name);
  if (firstName || lastName) return { firstName, lastName };
  const split = splitFullName(p.name);
  return split.firstName || split.lastName ? split : null;
}

/** Apple sends `name` only on the very first sign-in. */
export function namesFromApple(p: { name?: { firstName?: string; lastName?: string } } | undefined): Names | null {
  const firstName = clean(p?.name?.firstName);
  const lastName = clean(p?.name?.lastName);
  return firstName || lastName ? { firstName, lastName } : null;
}

/**
 * Better Auth's Apple provider joins `token.user.name` into one `name` string
 * before it calls `mapProfileToUser` (core/dist/social-providers/apple.mjs),
 * so the first/last pair is gone by then; split the string again.
 */
export function appleProfileNames(profile: { name?: unknown }): Names | null {
  const split = splitFullName(profile.name);
  return split.firstName || split.lastName ? split : null;
}
