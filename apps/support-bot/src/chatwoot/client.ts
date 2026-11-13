/**
 * The bot's view of the Chatwoot Application API. The implementation lives
 * in @openbookings/support, shared with apps/business; this module is the
 * single import point inside the bot, which is also what the tests mock.
 */
export {
  getConversationMessages,
  handOffToHuman,
  postReply,
  setTypingStatus,
} from "@openbookings/support";
