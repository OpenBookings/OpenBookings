/** Slugs live in properties.slug (varchar 255); 200 leaves room for a suffix. */
const MAX_LENGTH = 200;

/**
 * Letters with no NFD decomposition, which would otherwise be destroyed by the
 * `[^a-z0-9]` pass rather than folded. Nordic and German property names depend
 * on these: without the map, "Ærøskøbing Kro" slugs to "-r-sk-bing-kro".
 */
const LIGATURES: Record<string, string> = {
  "æ": "ae",
  "œ": "oe",
  "ø": "o",
  "ß": "ss",
  "đ": "d",
  "ð": "d",
  "þ": "th",
  "ł": "l",
  "ħ": "h",
  "ı": "i",
  "ŧ": "t",
};

/**
 * Derive a URL slug from a property's display name.
 *
 * Accents are folded rather than stripped, so "Hôtel Crémieux" becomes
 * "hotel-cremieux" and not "htel-crmieux". Letters with no Latin form at all
 * (like Nordic and German ligatures: æ, ø, ß, þ, etc.) are also folded to
 * their closest equivalents. Scripts with no Latin form whatsoever fold to
 * nothing, so there is an explicit fallback — a property is never left with
 * an empty slug, which would collide with the /p/ index route.
 *
 * Apostrophes are elided rather than turned into separators, so "O'Brien's Inn"
 * becomes "obriens-inn" not "o-brien-s-inn".
 */
export function toSlug(input: string): string {
  const slug = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[æœøßđðþłħıŧ]/g, (c) => LIGATURES[c])
    // Elided, not separated: "O'Brien's Inn" is "obriens-inn", not "o-brien-s-inn".
    // Escapes, not literals: a literal curly quote here is invisible to review and
    // silently collapses to an ASCII one when copied. U+2018/U+2019 are the smart-quote
    // pair Apple platforms substitute by default; U+02BC is the modifier-letter form.
    .replace(/['\u2018\u2019\u02bc]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, "");

  return slug.length > 0 ? slug : "property";
}

/**
 * Slug candidates in the order the promotion should try them, bounded so a
 * pathological run of collisions terminates rather than spinning.
 *
 * Suffixing starts at 2: "grand-hotel-1" reads like a mistake to a host who
 * only has one property, while "grand-hotel-2" reads like the second one.
 */
export function slugCandidates(base: string, max = 20): string[] {
  const root = toSlug(base);
  return Array.from({ length: max }, (_, i) =>
    i === 0 ? root : `${root}-${i + 1}`
  );
}