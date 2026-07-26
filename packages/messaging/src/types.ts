/** A messages row (see packages/db/migrations/0002-0004). sender_id is NULL
 * once the retention sweep has anonymized the message. */
export type MessageRow = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  sender_role: "host" | "guest";
  body: string;
  flagged_reason: string | null;
  read_at: string | null;
  created_at: string;
};

/** Alias used by client code; same row shape as the API returns. */
export type ThreadMessage = MessageRow;

/** Shape of the host dashboard's thread list (see the messages page query). */
export type ThreadListItem = {
  id: string;
  status: string;
  updated_at: string;
  booking_id: string | null;
  property_name: string;
  guest_name: string | null;
  guest_image: string | null;
  last_message_body: string | null;
  last_message_at: string | null;
  last_message_sender_role: "host" | "guest" | null;
  unread_count: number;
};

export const MAX_BODY_LENGTH = 5000;

export const CIRCUMVENTION_WARNING =
  "This message may contain contact info. Sharing contact details off-platform isn't allowed.";
