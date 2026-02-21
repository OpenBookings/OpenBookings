import { ServerClient } from "postmark"

const token = process.env.POSTMARK_SERVER_TOKEN
if (!token || token.trim() === "") {
  throw new Error("POSTMARK_SERVER_TOKEN is required; set it in your environment.")
}

export const postmarkClient = new ServerClient(token)
