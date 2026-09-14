import { createAuthClientInstance } from "@openbookings/auth/client";

export const authClient = createAuthClientInstance(
  process.env.NEXT_PUBLIC_WEB_URL || "https://openbookings.co"
);
