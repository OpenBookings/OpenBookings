import * as Sentry from "@sentry/nextjs";
import { propertyPageKey, purge } from "@openbookings/cache";
import { queryOne } from "@openbookings/db";
import { refreshPublicPropertyPage } from "./refresh-public-page";
import { isValidSlug } from "./slug";

export type PurgeTarget = { propertyId: string } | { roomId: string };

export type QueryOneFn = <T>(text: string, values?: unknown[]) => Promise<T | null>;

/** Injection seam, following the `{ queryOne }` convention in @openbookings/authz. */
export interface PurgeDeps {
  queryOne?: QueryOneFn;
  purge?: (keys: string[]) => Promise<void>;
}

const report = (error: unknown, phase: string) =>
  Sentry.captureException(error, { tags: { area: "cache", surface: "property-page", phase } });

/**
 * Drop every cached copy of the public listing page: the data in Redis, the
 * guest app's rendered page, and Cloudflare's copy, in that order (each one
 * is rebuilt from the one before it).
 *
 * Separate from the resolving version below because `revalidateBoth` in the
 * property actions has already looked the slug up for its own reasons, and a
 * second identical query on every save is waste.
 */
export async function purgePropertyPageBySlug(slug: string): Promise<void> {
  // The slug becomes a cache key, a revalidate path and a CDN URL: only the
  // shape toSlug produces gets that far.
  if (!isValidSlug(slug)) {
    report(new Error("refusing to purge a malformed slug"), "purge");
    return;
  }
  await purge([propertyPageKey(slug)], {
    onError: (error, ctx) => report(error, ctx.phase),
  });
  await refreshPublicPropertyPage(slug, { onError: report });
}

/**
 * Drop the listing page's cached copy for the property a write just touched.
 *
 * Takes an id rather than a slug because the four call sites hold different
 * ones: the image routes know a property, the rate-plan action knows a room.
 * Resolving here means the `rooms → properties` join exists once.
 *
 * Nothing in here may throw. Every caller is a write that has already
 * committed — the host's property *is* saved — so a failure to purge must cost
 * a stale page until the TTL expires, never a save that reports failure.
 */
export async function purgePropertyPage(
  target: PurgeTarget,
  deps: PurgeDeps = {},
): Promise<void> {
  const one = deps.queryOne ?? queryOne;
  try {
    const row =
      "propertyId" in target
        ? await one<{ slug: string }>(`SELECT slug FROM properties WHERE id = $1`, [
            target.propertyId,
          ])
        : await one<{ slug: string }>(
            `SELECT p.slug FROM rooms r
             JOIN properties p ON p.id = r.property_id
             WHERE r.id = $1`,
            [target.roomId],
          );

    // The row can be gone: a property deleted in another tab, a room removed
    // between the write and this call. There is no key to purge, and nothing
    // here is worth reporting.
    if (!row) return;

    if (deps.purge) {
      await deps.purge([propertyPageKey(row.slug)]);
      return;
    }
    await purgePropertyPageBySlug(row.slug);
  } catch (error) {
    report(error, "purge");
  }
}
