/**
 * Divides `numerator` by `denominator` and rounds to the nearest integer,
 * with exact halves going away from zero (2.5 -> 3, -2.5 -> -3). Because the
 * rounding is symmetric, a negated amount always rounds to the negated result.
 * The denominator must be positive.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("roundHalfUp: denominator must be positive");
  }
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (2n * abs + denominator) / (2n * denominator);
  return negative ? -rounded : rounded;
}

/**
 * Formats signed integer cents as euros for invoices and emails:
 * `€1,234.56`, `€0.00`, and `−€9.00` with a real minus sign (U+2212).
 * Works on the bigint directly, so large amounts never pass through a float.
 */
export function formatEuro(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "−" : ""}€${whole}.${fraction}`;
}
