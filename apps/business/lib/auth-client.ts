import { createHostAuthClient } from "@openbookings/auth/client/host";

export const authClient = createHostAuthClient(
  process.env.NEXT_PUBLIC_APP_URL ?? "https://business.openbookings.co"
);
