/**
 * @openbookings/support — the Chatwoot integration for host support, shared
 * by apps/support-bot and apps/business. Server-only: nothing here may be
 * imported into client components (it reads tokens from the environment).
 *
 * What lives here is Chatwoot plumbing only. Product decisions — ticket
 * categories, status labels, copy, who may see which ticket — stay in the
 * app that owns them.
 */
export { chatwootConfig, envFlag, supportFlags } from "./config";
export * from "./types";
export * as applicationApi from "./application";
export {
  getConversationMessages,
  postPrivateNote,
  postReply,
  setConversationCustomAttributes,
  setConversationStatus,
  setTypingStatus,
} from "./application";
export * as clientApi from "./client-api";
export { ClientApiError } from "./client-api";
export { handOffToHuman } from "./handoff";
export { identifierHash } from "./identity";
export { SIGNATURE_TOLERANCE_SECONDS, verifyChatwootSignature } from "./signature";
