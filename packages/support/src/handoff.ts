import { postPrivateNote, setConversationStatus } from "./application";

/**
 * Hand a conversation from the assistant to the support team: an internal
 * note saying why, then status `open` so it lands in the team's queue.
 *
 * The one hand-off implementation. The support bot calls it when its rules or
 * the model escalate; the business app calls it when the host presses
 * "Talk to a person" or answers "No" to "Did this answer your question?".
 */
export async function handOffToHuman(conversationId: number, note: string): Promise<void> {
  await postPrivateNote(conversationId, note);
  await setConversationStatus(conversationId, "open");
}
