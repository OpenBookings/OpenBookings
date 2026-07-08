import { createAuthClient } from "better-auth/react";
import {
  magicLinkClient,
  organizationClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";

export function createAuthClientInstance(baseURL: string) {
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
