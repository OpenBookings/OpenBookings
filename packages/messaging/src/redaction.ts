/**
 * What replaces a message body once it has to go, whether because the
 * retention window passed or because the guest deleted their account.
 *
 * One value for both on purpose: the retention sweep decides "already done"
 * by comparing the body to this, so a message redacted by account deletion is
 * recognised as finished instead of being swept again, and one that somehow
 * escaped deletion is still caught. (It used to key on `sender_id IS NOT
 * NULL`, which skipped every deleted guest's messages forever and left their
 * text readable.)
 *
 * Its own file, with no imports, so apps/web can use it without pulling in
 * the messaging server entry (db pool, node:crypto).
 */
export const REDACTED_MESSAGE_BODY = "[message removed — retention period expired]";
