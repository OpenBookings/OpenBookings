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

export type ThreadMessage = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  sender_role: "host" | "guest";
  body: string;
  flagged_reason: string | null;
  read_at: string | null;
  notified_at: string | null;
  created_at: string;
};
