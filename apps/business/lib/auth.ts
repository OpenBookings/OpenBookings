import { createAuth } from "@openbookings/auth/server";
import { sendMagicLink } from "@/lib/mailing/magic-link";

export const auth = createAuth({
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://business.openbookings.co",
  secret: process.env.BETTER_AUTH_SECRET!,
  databaseUrl: process.env.DATABASE_URL!,
  sendMagicLink,
  trustedOrigins: [
    "https://appleid.apple.com",
    "https://business.openbookings.co",
    "https://openbookings.co",
  ],
  dashApiKey: process.env.BETTER_AUTH_DASH_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID_BUSINESS,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET_BUSINESS,
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  accountType: "business",
});
