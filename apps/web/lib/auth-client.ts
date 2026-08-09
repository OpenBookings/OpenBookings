import { createGuestAuthClient } from "@openbookings/auth/client/guest";

export const authClient = createGuestAuthClient(
  process.env.NEXT_PUBLIC_APP_URL ?? "https://openbookings.co"
);
