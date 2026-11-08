import { Lettermint } from "lettermint";

let cachedClient: ReturnType<typeof Lettermint.email> | null = null;

export function getEmailClient(): ReturnType<typeof Lettermint.email> {
  if (cachedClient) return cachedClient;

  const token = process.env.LETTERMINT_PROJECT_TOKEN ?? "";

  if (!token || token.trim() === "") {
    throw new Error(
      "LETTERMINT_PROJECT_TOKEN is required; set it in your environment."
    );
  }

  cachedClient = Lettermint.email(token);
  return cachedClient;
}
