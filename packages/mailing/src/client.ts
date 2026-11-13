import { Lettermint, type EmailBuilder } from "lettermint";

let cachedClient: Lettermint | null = null;
let consoleMode = false;

/**
 * A new email, ready to fill in: `getEmailClient().from(...).to(...).send()`.
 * Lettermint by default.
 *
 * Each call starts an empty, immutable builder (every setter returns a new
 * one), so emails composed at the same time never share recipients or
 * content. The Lettermint client behind it is created once.
 *
 * With `EMAIL_TRANSPORT=console` (local development only), emails are printed
 * to the terminal instead of sent, so the apps run without an email provider:
 * a sign-in link shows up in the dev server's output. It is refused in
 * production, where a silent "sent" that went nowhere would lose real mail.
 */
export function getEmailClient(): EmailBuilder {
  if (consoleMode) return consoleEmailClient();
  if (cachedClient) return cachedClient.emails.compose();

  if (process.env.EMAIL_TRANSPORT?.trim() === "console") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_TRANSPORT=console is for local development only; it is refused in production.");
    }
    consoleMode = true;
    return consoleEmailClient();
  }

  const token = process.env.LETTERMINT_PROJECT_TOKEN ?? "";

  if (!token || token.trim() === "") {
    throw new Error(
      "LETTERMINT_PROJECT_TOKEN is required; set it in your environment (or EMAIL_TRANSPORT=console for local development)."
    );
  }

  cachedClient = new Lettermint({ sendingToken: token });
  return cachedClient.emails.compose();
}

/**
 * A stand-in with the same shape as Lettermint's builder: every setter
 * returns a new builder with that field recorded, and `send()` prints the
 * message. Links are listed separately, since the HTML is hard to read in a
 * terminal and the sign-in link is usually what you came for.
 */
export function consoleEmailClient(log: (text: string) => void = console.log): EmailBuilder {
  const builder = (fields: Record<string, unknown[]>): EmailBuilder =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          // Not a thenable: awaiting the builder must not call send().
          if (prop === "then") return undefined;
          if (prop === "send") {
            return async () => {
              log(formatConsoleEmail(fields));
              return { message_id: `console-${Date.now()}`, status: "logged" };
            };
          }
          return (...args: unknown[]) => builder({ ...fields, [String(prop)]: args });
        },
      },
    ) as EmailBuilder;

  return builder({});
}

export function formatConsoleEmail(fields: Record<string, unknown[]>): string {
  const first = (key: string) => {
    const value = fields[key]?.[0];
    return Array.isArray(value) ? value.join(", ") : value === undefined ? "" : String(value);
  };
  const html = first("html");
  const text = first("text");
  // Clickable links only: href targets in the HTML and bare URLs in the text,
  // not the image sources (logos, tracking pixels).
  const hrefs = [...html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]!);
  const bare = text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const links = [...new Set([...hrefs, ...bare].map((url) => url.replace(/&amp;/g, "&")))];
  const lines = [
    "",
    "──── email (EMAIL_TRANSPORT=console, not sent) ────",
    `From:    ${first("from")}`,
    `To:      ${first("to")}`,
    `Subject: ${first("subject")}`,
  ];
  if (text) lines.push("", text.trim());
  if (links.length > 0) lines.push("", "Links:", ...links.map((url) => `  ${url}`));
  lines.push("────────────────────────────────────────────────────", "");
  return lines.join("\n");
}
