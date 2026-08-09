import { createAuthClient } from "better-auth/react";
import {
  magicLinkClient,
  organizationClient,
  twoFactorClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { ac, roles } from "@openbookings/authz/permissions";

/**
 * Client for apps/business, matching the host server's plugin set. The
 * shared ac/roles give checkRolePermission the same statement the server
 * enforces — client checks are cosmetic only.
 */
export function createHostAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [
      magicLinkClient(),
      organizationClient({ ac, roles }),
      passkeyClient(),
      twoFactorClient(),
      inferAdditionalFields({
        user: { account_type: { type: "string" } },
      }),
    ],
  });
}
