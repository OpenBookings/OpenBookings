import { categoryLabel } from "./categories";

const TITLE_FROM_MESSAGE_MAX = 60;

/**
 * A ticket's title, fixed at creation:
 *
 * 1. category plus the linked item — "Payments & payouts · Booking #0a1b2c3d";
 * 2. otherwise the first line of the host's message, up to 60 characters;
 * 3. otherwise the category label alone.
 *
 * Never "Untitled".
 */
export function ticketTitle(input: {
  category: string;
  linkedLabel?: string | null;
  message?: string | null;
}): string {
  const label = categoryLabel(input.category);
  const linked = input.linkedLabel?.trim();
  if (linked) return `${label} · ${linked}`;

  const firstLine = input.message?.split("\n").map((line) => line.trim()).find(Boolean);
  if (firstLine) {
    if (firstLine.length <= TITLE_FROM_MESSAGE_MAX) return firstLine;
    const cut = firstLine.slice(0, TITLE_FROM_MESSAGE_MAX - 1);
    // Break at a word when there is one in the last third.
    const space = cut.lastIndexOf(" ");
    return `${space > TITLE_FROM_MESSAGE_MAX * 0.66 ? cut.slice(0, space) : cut}…`;
  }
  return label;
}

/**
 * The first message when the host left the message empty, so no
 * conversation starts blank: "Category: Payments & payouts · Booking #0a1b2c3d".
 */
export function structuredOpener(input: { category: string; linkedLabel?: string | null }): string {
  const parts = [`Category: ${categoryLabel(input.category)}`];
  if (input.linkedLabel?.trim()) parts.push(input.linkedLabel.trim());
  return parts.join(" · ");
}
