import { createGuestAuthClient } from "@openbookings/auth/client/guest";

export const authClient = createGuestAuthClient(
  process.env.NEXT_PUBLIC_WEB_URL || "https://openbookings.co"
);
