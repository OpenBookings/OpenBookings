/** Something a person must look at. The app has no Sentry SDK (nor does support-bot): the error/warning log line is the alert. */
export function alert(level: "error" | "warning", message: string, extra: Record<string, unknown>): void {
  if (level === "error") console.error(`[siteminder] ${message}`, extra);
  else console.warn(`[siteminder] ${message}`, extra);
}
