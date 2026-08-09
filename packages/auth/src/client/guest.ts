import { createAuthClient } from "better-auth/react";
import {
  magicLinkClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";

/** Client for apps/web. No organization plugin — the guest server doesn't mount it. */
export function createGuestAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [
      magicLinkClient(),
      inferAdditionalFields({
        user: { account_type: { type: "string" } },
      }),
    ],
  });
}
