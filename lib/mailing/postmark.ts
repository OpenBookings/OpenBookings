import { ServerClient } from "postmark"

const token = process.env.POSTMARK_API_KEY
if (!token || token.trim() === "") {
  throw new Error("POSTMARK_API_KEY is required; set it in your environment.")
}

export const postmarkClient = new ServerClient(token)
