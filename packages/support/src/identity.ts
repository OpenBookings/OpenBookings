import { createHmac } from "node:crypto";

/**
 * Chatwoot identity validation: hex HMAC-SHA256 of the contact identifier,
 * keyed with the inbox's HMAC token. Without it (or with a wrong one)
 * Chatwoot refuses the contact, so nobody can claim another user's
 * conversations by guessing their user id.
 */
export function identifierHash(identifier: string, hmacToken: string): string {
  return createHmac("sha256", hmacToken).update(identifier).digest("hex");
}
