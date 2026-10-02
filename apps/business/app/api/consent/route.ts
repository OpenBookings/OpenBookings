import { createConsentHandler } from "@openbookings/analytics/consent-route";
import { insertConsentEvent } from "@openbookings/db";
import { getServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Records one cookie-consent event as evidence. Public, because most visitors
 * deciding about cookies are not signed in; see createConsentHandler for what
 * it accepts and why it stores no IP address.
 *
 * Rate limiting for this path is a Cloudflare rule, not application code.
 */
export const POST = createConsentHandler({
  app: "business",
  insert: insertConsentEvent,
  getUserId: async () => (await getServerSession())?.user.id ?? null,
});
