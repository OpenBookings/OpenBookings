import { betterAuth } from "better-auth"
import { magicLink } from "better-auth/plugins"
import { Pool } from "pg"
import { sendMagicLink } from "@/lib/mailing/magic-link"

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://openbookings.co",
  secret: process.env.BETTER_AUTH_SECRET!,
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLink(email, url)
      },
      expiresIn: 60 * 15, // 15 minutes
    }),
  ],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
    },
  },
})
