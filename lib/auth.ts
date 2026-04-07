import { betterAuth } from "better-auth"
import { magicLink } from "better-auth/plugins"
import { dash } from "@better-auth/infra";
import { Pool } from "pg"
import { sendMagicLink } from "@/lib/mailing/magic-link"
import { importPKCS8, SignJWT } from "jose";

// Generate the client secret JWT required for 'Sign in with Apple'.
async function generateAppleClientSecret(clientId: string, teamId: string, keyId: string, privateKey: string) {
  const key = await importPKCS8(privateKey, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 180 * 24 * 60 * 60)
    .sign(key);
}

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
    dash({
      apiKey: process.env.BETTER_AUTH_DASH_API_KEY!,
    })
  ],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: await generateAppleClientSecret(
        process.env.APPLE_CLIENT_ID!,
        process.env.APPLE_TEAM_ID!,
        process.env.APPLE_KEY_ID!,
        process.env.APPLE_PRIVATE_KEY!,
      ),
    },
  },
  trustedOrigins: ["https://appleid.apple.com"], 
})
