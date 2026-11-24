import { parseEuroInput } from "@openbookings/pricing/money";
import { z } from "zod";

/**
 * A goodwill refund amount from the browser: the text the host typed ("12,50",
 * "12.5"), read into cents on the server. Anything else is refused: a number
 * (the browser is trusted for nothing), junk, three decimals, a thousands
 * separator, or zero.
 */
export const goodwillAmount = z
  .string()
  .transform((text, ctx) => {
    const parsed = parseEuroInput(text);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.error });
      return z.NEVER;
    }
    return parsed.cents;
  })
  .pipe(z.number().int().positive());
