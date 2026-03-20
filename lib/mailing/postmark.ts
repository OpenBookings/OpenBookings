import { ServerClient } from "postmark"

let cachedClient: ServerClient | null = null

export function getPostmarkClient() {
  if (cachedClient) return cachedClient

  const token =
    process.env.NEXT_PUBLIC_POSTMARK_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_POSTMARK_API_KEY ?? ""

  if (!token || token.trim() === "") {
    throw new Error(
      "NEXT_PUBLIC_POSTMARK_SERVER_TOKEN or NEXT_PUBLIC_POSTMARK_API_KEY is required; set it in your environment."
    )
  }

  cachedClient = new ServerClient(token)
  return cachedClient
}
