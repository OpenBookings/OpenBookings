import * as Sentry from "@sentry/nextjs";
import { cached, purge, propertyReviewsKey } from "@openbookings/cache";
import { getPool } from "@openbookings/db";
import { loadPropertyReviews, type PropertyReviews } from "@openbookings/db/reviews";
import { isTestingMode } from "@openbookings/demo";

/**
 * A property's published reviews, cached hard for a day: a new review can take
 * up to 24 hours to show, and in return nobody's page view queries them.
 * Only a review its author deletes is purged straight away.
 */
const PROPERTY_REVIEWS_TTL = {
  freshSeconds: Number(process.env.CACHE_TTL_PROPERTY_REVIEWS_S) || 86_400,
  // A day of stale on top, served only if Postgres fails on a refresh.
  maxAgeSeconds: Number(process.env.CACHE_MAX_AGE_PROPERTY_REVIEWS_S) || 172_800,
};

const report = (error: unknown, ctx: { phase: string; key: string }) =>
  Sentry.captureException(error, {
    tags: { area: "cache", surface: "property-reviews", phase: ctx.phase },
    extra: { key: ctx.key },
  });

/**
 * Never throws: the reviews are one card on the property page, and a failure
 * here must not take the page down with it. Null = leave the card out.
 */
export async function getPropertyReviews(propertyId: string): Promise<PropertyReviews | null> {
  try {
    return await cached<PropertyReviews>(
      propertyReviewsKey(propertyId),
      () => loadPropertyReviews(getPool(), propertyId, new Date()),
      { ...PROPERTY_REVIEWS_TTL, ...(isTestingMode() ? { redis: null } : {}), onError: report },
    );
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "reviews", surface: "property-page" }, extra: { propertyId } });
    return null;
  }
}

/** Drops the cached reviews, so a deleted review leaves the page now rather than tomorrow. */
export async function purgePropertyReviews(propertyId: string): Promise<void> {
  await purge([propertyReviewsKey(propertyId)], { onError: report });
}
