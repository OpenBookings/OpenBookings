import { createAuthClient } from "better-auth/react";
import { magicLinkClient, organizationClient } from "better-auth/client/plugins";

export function createAuthClientInstance(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [magicLinkClient(), organizationClient()],
  });
}
