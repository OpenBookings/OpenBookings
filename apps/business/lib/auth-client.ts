import { createAuthClientInstance } from "@openbookings/auth/client";

export const authClient = createAuthClientInstance(
  process.env.NEXT_PUBLIC_BUSINESS_URL || "https://business.openbookings.co"
);
