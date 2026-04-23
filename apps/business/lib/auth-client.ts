import { createAuthClientInstance } from "@openbookings/auth/client";

export const authClient = createAuthClientInstance(
  process.env.NEXT_PUBLIC_APP_URL ?? "https://host.openbookings.co"
);
