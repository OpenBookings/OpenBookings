import { createAuthClient } from "better-auth/react";
import {
  magicLinkClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

/** Client for apps/web, matching the guest server: no organization or two-factor plugin. */
export function createGuestAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [
      magicLinkClient(),
      passkeyClient(),
      inferAdditionalFields({
        user: { account_type: { type: "string" } },
      }),
    ],
  });
}
