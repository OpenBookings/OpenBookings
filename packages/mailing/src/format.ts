const euros = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });

/** "€1,234.50": British English, as the host's refund sentences read. */
export function formatEuro(amount: number): string {
  return euros.format(amount);
}

const stayDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * "Fri 12 Mar 2027" from a YYYY-MM-DD string. Built at UTC midnight and
 * formatted in UTC, so the day never moves with the server's time zone.
 */
export function formatStayDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return stayDate.format(new Date(Date.UTC(y!, m! - 1, d!))).replace(",", "");
}
