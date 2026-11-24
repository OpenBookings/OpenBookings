/**
 * Shared money helpers. Every amount is an integer number of cents (EUR only).
 */

/** Round to an integer, half away from zero: 2.5 -> 3, -2.5 -> -3. */
export function roundHalfUp(x: number): number {
  const rounded = Math.round(Math.abs(x));
  return x < 0 && rounded !== 0 ? -rounded : rounded;
}

/** `percent` of an amount in cents, rounded half up: (9999, -10) -> -1000. */
export function percentOfCents(cents: number, percent: number): number {
  return roundHalfUp((cents * percent) / 100);
}

/**
 * "€89" / "€89.50" / "€1,234"; a negative amount gets a real minus sign: "−€60.50".
 * `whole: "auto"` (default) drops the decimals for whole euros,
 * `"always-decimals"` always shows two.
 */
export function formatCents(
  cents: number,
  opts: { whole?: "auto" | "always-decimals" } = {},
): string {
  const abs = Math.abs(cents);
  const whole = (opts.whole ?? "auto") === "auto" && abs % 100 === 0;
  const [euros = "0", fraction] = (abs / 100).toFixed(2).split(".");
  const grouped = euros.replace(/\B(?=(\d{3})+$)/g, ",");
  const text = whole ? `€${grouped}` : `€${grouped}.${fraction}`;
  return cents < 0 ? `−${text}` : text;
}

/** Parse a host-typed euro amount ("89", "89.5", "89,50") into cents. */
export function parseEuroInput(
  raw: string,
): { ok: true; cents: number } | { ok: false; error: string } {
  const text = raw.trim();
  if (/^-\s*\d/.test(text)) {
    return { ok: false, error: "Enter an amount of 0 or more" };
  }
  if (/^\d+[.,]\d{3,}$/.test(text)) {
    return { ok: false, error: "Use at most two decimals" };
  }
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text);
  if (!match) {
    return { ok: false, error: "Enter an amount like 89 or 89.50" };
  }
  const euros = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = euros * 100 + fraction;
  if (!Number.isSafeInteger(cents)) {
    return { ok: false, error: "Enter an amount like 89 or 89.50" };
  }
  return { ok: true, cents };
}

/** Cents as text for a price field: 8950 -> "89.50", 8900 -> "89". */
export function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
