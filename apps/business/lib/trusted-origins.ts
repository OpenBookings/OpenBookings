/**
 * Origins the host portal's auth accepts state-changing requests from, besides
 * its own base URL (which Better Auth always trusts).
 *
 * Deliberately NOT here in production:
 *  - the guest origin (openbookings.co): the two apps are as foreign to each
 *    other as any third party, and a trusted origin is one that can drive
 *    cookie-authenticated host requests from the browser;
 *  - appleid.apple.com: the host portal has no Apple provider (that is the
 *    guest app's);
 *  - localhost: development only.
 */
export function hostTrustedOrigins(nodeEnv: string | undefined): string[] {
  return [
    "https://business.openbookings.co",
    ...(nodeEnv === "production" ? [] : ["http://business.localhost:3001"]),
  ];
}
