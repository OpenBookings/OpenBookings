import { loadTemplate } from "./template";

/** One finished email: what the guest or host sees. */
export type ActionMail = { subject: string; html: string };

/**
 * Fills the shared "account-action" layout (headline, short body, one button).
 * `details` is an optional block between the body and the button, such as a
 * price breakdown. `headline`, `body`, `details` and `footnote` are HTML
 * written by the caller, who escapes everything that came from a guest or
 * host. Every other field is plain text, escaped by loadTemplate.
 */
export function composeActionMail(input: {
  subject: string;
  preheader: string;
  eyebrow: string;
  headline: string;
  body: string;
  details?: string;
  ctaUrl: string;
  ctaLabel: string;
  footnote: string;
}): ActionMail {
  return {
    subject: input.subject,
    html: loadTemplate("account-action", { ...input, details: input.details ?? "" }, { htmlSlots: ["headline", "body", "details", "footnote"] }),
  };
}
