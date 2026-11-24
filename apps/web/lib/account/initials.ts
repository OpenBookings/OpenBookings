type UserNames = { firstName?: string | null; lastName?: string | null; name?: string | null };

/**
 * Avatar initials: the first letter of the first name and of the last name
 * (`AV` for Anna de / Vries). A user without either (a legacy sign-up with no
 * name, or a stale session) falls back to the first letters of the full name,
 * and to `?` when there is none.
 */
export function userInitials({ firstName, lastName, name }: UserNames): string {
  const first = firstName?.trim() ?? "";
  const last = lastName?.trim() ?? "";
  const parts = first || last ? [first, last] : (name?.trim() ?? "").split(" ");
  return (
    parts
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}
