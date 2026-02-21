import { ServerClient } from "postmark"

const apiKey = process.env.POSTMARK_API_KEY
if (!apiKey) {
  console.warn("POSTMARK_API_KEY is not set; email sending will fail.")
}

export const postmarkClient = new ServerClient(apiKey ?? "")
