import { parseEuroInput } from "@openbookings/pricing/money";
import { z } from "zod";

/**
 * A euro amount as a host typed it ("89", "89.5", "89,50"), read into whole
 * cents on the server. The browser sends text, never a number: it is trusted
 * for nothing, and a float would lose the cents. Three decimals, a thousands
 * separator, a minus sign or junk are refused with parseEuroInput's message.
 * Pipe the result into the range the field allows.
 */
export const euroCents = z.string({ error: "Enter an amount like 89 or 89.50" }).transform((text, ctx) => {
  const parsed = parseEuroInput(text);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }
  return parsed.cents;
});
