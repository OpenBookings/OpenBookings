/** Chatwoot payload shapes this package reads. Only the fields we use. */

export type ChatwootStatus = "pending" | "open" | "snoozed" | "resolved";

/** 0 incoming (contact), 1 outgoing (agent or bot), 2 activity, 3 template. */
export type ChatwootMessageType = 0 | 1 | 2 | 3;

export type ChatwootAttachment = {
  id: number;
  /** "image" | "audio" | "video" | "file" | … */
  file_type: string;
  data_url: string;
  thumb_url?: string | null;
  file_size?: number | null;
  extension?: string | null;
  content_type?: string | null;
};

export type ChatwootSender = {
  id?: number;
  name?: string | null;
  available_name?: string | null;
  /** "contact" | "user" | "agent_bot" on REST payloads. */
  type?: string | null;
};

/**
 * A message as the Client API and the websocket return it. The websocket
 * adds `private`, `sender_type` ("Contact" | "User" | "AgentBot") and
 * `echo_id`; REST omits them.
 */
export type ChatwootMessage = {
  id: number;
  content: string | null;
  message_type: number;
  content_type?: string | null;
  content_attributes?: Record<string, unknown> | null;
  created_at: number;
  conversation_id?: number;
  private?: boolean;
  sender?: ChatwootSender | null;
  sender_type?: string | null;
  attachments?: ChatwootAttachment[] | null;
  echo_id?: string | null;
};

export type WorkingHoursDay = {
  /** 0 = Sunday … 6 = Saturday. */
  day_of_week: number;
  closed_all_day: boolean;
  open_all_day: boolean;
  open_hour: number | null;
  open_minutes: number | null;
  close_hour: number | null;
  close_minutes: number | null;
};

export type InboxInfo = {
  name: string;
  timezone: string;
  workingHours: WorkingHoursDay[];
};
