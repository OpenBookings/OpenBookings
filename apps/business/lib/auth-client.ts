import { createHostAuthClient } from "@openbookings/auth/client/host";

export const authClient = createHostAuthClient(
  process.env.NEXT_PUBLIC_BUSINESS_URL || "https://business.openbookings.co"
);
