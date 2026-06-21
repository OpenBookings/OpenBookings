import { Lettermint } from "lettermint";
import { templates } from "./templates";

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

export function loadTemplate(name: string, vars: Record<string, string>): string {
  const raw = templates[name];
  if (!raw) throw new Error(`No email template found: "${name}"`);
  return Object.entries(vars).reduce(
    (html, [key, val]) => html.replaceAll(`{{${key}}}`, val),
    raw
  );
}
