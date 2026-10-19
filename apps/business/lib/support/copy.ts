/**
 * Every line that tells the host they're talking to an AI, in one place
 * (EU AI Act Article 50 transparency). Get the wording checked once and keep
 * it here; components import these instead of writing their own.
 */
export const AI_COPY = {
  /** Intake footer, before the chat starts. */
  intakeDisclosure: "You'll start with our AI assistant. You can ask for a person at any time.",
  /** Name on every assistant message group. */
  assistantName: "Assistant",
  /** Badge next to that name. */
  assistantBadge: "AI",
  /** Line under the composer while the assistant handles the ticket. */
  composerAssistant: "AI assistant · can make mistakes",
  talkToPerson: "Talk to a person",
  /** Line under the composer once people have the ticket. */
  composerTeam: "With the support team",
  /** Label for messages from people on the support team. */
  teamLabel: "Support team",
} as const;

/** Intake footer when the assistant is switched off. */
export const TEAM_ONLY_DISCLOSURE = "Our support team will reply here.";

export const ORB_LABELS = {
  searching: "Looking into it…",
  composing: "Writing a reply…",
  stalled: "Still working on it…",
} as const;
