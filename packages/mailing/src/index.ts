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

/** Escapes the five characters that matter in HTML text and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Fill `{{name}}` placeholders in a template.
 *
 * Every value is HTML-escaped unless its name is listed in `htmlSlots`. That
 * way a caller has to opt IN to inserting markup, and forgetting to escape an
 * email address, a name or a URL (all of which can contain `<`, `"` or `&`) is
 * not a way to inject HTML into a message we send from our own domain. Only
 * name a slot in `htmlSlots` when its value is markup the caller built and
 * escaped the user-supplied parts of itself.
 *
 * One pass over the template: a substituted value is never scanned again, so a
 * value that happens to contain `{{other}}` cannot pull another variable's
 * value into the message. Placeholders with no matching variable are left as
 * written.
 */
export function loadTemplate(
  name: string,
  vars: Record<string, string>,
  options: { htmlSlots?: readonly string[] } = {},
): string {
  const raw = templates[name];
  if (!raw) throw new Error(`No email template found: "${name}"`);
  const htmlSlots = new Set(options.htmlSlots ?? []);
  return raw.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => {
    if (!Object.hasOwn(vars, key)) return placeholder;
    const value = vars[key];
    return htmlSlots.has(key) ? value : escapeHtml(value);
  });
}
