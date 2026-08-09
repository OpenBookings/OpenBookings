import { createAuthClient } from "better-auth/react";
import {
  magicLinkClient,
  organizationClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";

/** Client for apps/business, matching the host server's plugin set. */
export function createHostAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [
      magicLinkClient(),
      organizationClient(),
      inferAdditionalFields({
        user: { account_type: { type: "string" } },
      }),
    ],
  });
}
