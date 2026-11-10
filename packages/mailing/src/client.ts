import { Lettermint } from "lettermint";

type EmailClient = ReturnType<typeof Lettermint.email>;

let cachedClient: EmailClient | null = null;

/**
 * The email client every sender uses. Lettermint by default.
 *
 * With `EMAIL_TRANSPORT=console` (local development only), emails are printed
 * to the terminal instead of sent, so the apps run without an email provider:
 * a sign-in link shows up in the dev server's output. It is refused in
 * production, where a silent "sent" that went nowhere would lose real mail.
 */
export function getEmailClient(): EmailClient {
  if (cachedClient) return cachedClient;

  if (process.env.EMAIL_TRANSPORT?.trim() === "console") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_TRANSPORT=console is for local development only; it is refused in production.");
    }
    cachedClient = consoleEmailClient();
    return cachedClient;
  }

  const token = process.env.LETTERMINT_PROJECT_TOKEN ?? "";

  if (!token || token.trim() === "") {
    throw new Error(
      "LETTERMINT_PROJECT_TOKEN is required; set it in your environment (or EMAIL_TRANSPORT=console for local development)."
    );
  }

  cachedClient = Lettermint.email(token);
  return cachedClient;
}

/**
 * A stand-in with the same builder shape as Lettermint's client: every call
 * records its arguments and returns the builder, and `send()` prints the
 * message. Links are listed separately, since the HTML is hard to read in a
 * terminal and the sign-in link is usually what you came for.
 */
export function consoleEmailClient(log: (text: string) => void = console.log): EmailClient {
  const start = () => {
    const fields: Record<string, unknown[]> = {};
    const builder: Record<string | symbol, unknown> = new Proxy(
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
          return (...args: unknown[]) => {
            fields[String(prop)] = args;
            return builder;
          };
        },
      },
    );
    return builder;
  };

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined;
        // The first call in a chain (usually `.from(...)`) starts a new message.
        return (...args: unknown[]) => {
          const builder = start() as Record<string, (...a: unknown[]) => unknown>;
          return builder[String(prop)]!(...args);
        };
      },
    },
  ) as EmailClient;
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
