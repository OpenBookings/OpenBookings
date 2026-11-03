import { timingSafeEqual } from "node:crypto";

/**
 * Bearer check for the cron endpoints.
 *
 * `===` on strings short-circuits at the first differing byte, so how long the
 * comparison takes leaks how many leading bytes of the secret the caller got
 * right — recoverable one byte at a time by an attacker who can time enough
 * requests. `timingSafeEqual` always reads both buffers to the end. It throws
 * rather than returning false when the lengths differ, so length is checked
 * separately; that leaks only the secret's length, which is not the part worth
 * protecting.
 *
 * No secret configured means nothing is authorized, never "open".
 *
 * Its own module with no package imports so every cron route, in either app,
 * can use the same check.
 */
export function bearerAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const presented = Buffer.from(req.headers.get("authorization") ?? "");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
