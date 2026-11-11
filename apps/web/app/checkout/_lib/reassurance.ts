import type { PolicyStep } from '@openbookings/pricing';
import { formatMoney } from './ledger';
import { payAtPropertyNoun } from './party';

/** Under this much time left the hold label counts down in minutes. */
const URGENT_MS = 120_000;

/**
 * The hold label in the payment card header. `format` turns the expiry into a
 * clock time, injected so tests don't depend on the time zone.
 */
export function holdLabel(
  expiresAt: number,
  now: number,
  format: (ms: number) => string,
): { text: string; urgent: boolean } {
  const left = expiresAt - now;
  if (left > URGENT_MS) return { text: `Room held until ${format(expiresAt)}`, urgent: false };
  return { text: `${Math.max(1, Math.ceil(left / 60_000))} min left`, urgent: true };
}

/** The line above the Pay button, from each distinct set of cancellation terms. */
export function payReassurance(steps: PolicyStep[][]): { tone: 'free' | 'neutral'; text: string } {
  const frees = steps.map((s) => s.find((step) => step.kind === 'free'));
  if (steps.length > 0 && frees.every((f) => f?.until && f.deadlineLabel)) {
    const earliest = frees.reduce((a, b) => (Date.parse(b!.until!) < Date.parse(a!.until!) ? b : a));
    return { tone: 'free', text: `Free cancellation until ${earliest!.deadlineLabel}` };
  }
  if (steps.length > 0 && steps.every((s) => s.some((step) => step.kind === 'non_refundable'))) {
    return { tone: 'neutral', text: 'Non-refundable · you confirmed this above' };
  }
  return { tone: 'neutral', text: 'Cancellation terms differ per room. See the summary.' };
}

/** "+ €75.00 at the property for the extra bed": display only, never part of the charge. */
export function payAtPropertyLine(rooms: { payAtProperty: number; cots: number; extraBeds: number }[]): string | null {
  const noun = payAtPropertyNoun(rooms);
  if (!noun) return null;
  const total = rooms.reduce((n, r) => n + r.payAtProperty, 0);
  return `+ ${formatMoney(total)} at the property for the ${noun.text}`;
}
