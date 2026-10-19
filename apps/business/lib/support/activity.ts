import type { ChatMessage } from "./chat";
import { ORB_LABELS } from "./copy";
import type { TicketStatus } from "./status";

/** After this long without assistant activity, offer a person (proposal: 30 s). */
export const SILENT_ASSISTANT_MS = 30_000;

export type ActivityLine =
  | { kind: "orb"; state: "searching" | "composing"; label: string; offerPerson: boolean }
  | { kind: "text"; text: string }
  | null;

/**
 * What sits at the bottom of the chat, where the next reply will appear.
 * The orb is the assistant's signature and only ever shows for AI activity;
 * people get plain text.
 */
export function activityLine(input: {
  assistantEnabled: boolean;
  status: TicketStatus;
  messages: ChatMessage[];
  botTyping: boolean;
  personTyping: string | null;
  lastHostAt: number | null;
  waitEstimate: string;
  now: number;
}): ActivityLine {
  if (input.status === "resolved") return null;
  if (input.personTyping) return { kind: "text", text: `${input.personTyping} is typing…` };

  const awaiting = input.messages.at(-1)?.kind === "host";
  const withAssistant = input.assistantEnabled && input.status === "pending";

  if (withAssistant) {
    if (input.botTyping) return { kind: "orb", state: "composing", label: ORB_LABELS.composing, offerPerson: false };
    if (!awaiting) return null;
    const silentFor = input.lastHostAt === null ? 0 : input.now - input.lastHostAt;
    if (silentFor >= SILENT_ASSISTANT_MS) {
      return { kind: "orb", state: "searching", label: ORB_LABELS.stalled, offerPerson: true };
    }
    return { kind: "orb", state: "searching", label: ORB_LABELS.searching, offerPerson: false };
  }

  if (awaiting) return { kind: "text", text: `Waiting for the support team · usually ${input.waitEstimate}` };
  return null;
}
