import type { AppName } from "@openbookings/apps-contract";

/**
 * A guest's name for an app, from `"user".first_name` / `last_name` (0059).
 *
 * Channel managers require a surname (SiteMinder's `Surname` is mandatory), so
 * a guest with only a first name gets it as their surname, and a guest with no
 * name at all becomes "Guest". The text is otherwise passed on as typed
 * (particles, apostrophes, diacritics, any script); escaping is the app's job.
 */
export function appName(firstName: string, lastName: string): AppName {
  const first = firstName.trim();
  const last = lastName.trim();
  if (last) return { givenName: first, surname: last };
  if (first) return { givenName: "", surname: first };
  return { givenName: "", surname: "Guest" };
}
