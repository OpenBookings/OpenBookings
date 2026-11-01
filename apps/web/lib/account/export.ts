type Run = (sql: string, values: unknown[]) => Promise<unknown[]>;

/**
 * "Download my data" (GDPR Art. 15 and 20): everything we hold about the
 * guest, as JSON. Each query names its columns and is scoped to `$1`, the
 * session's user id. Secrets never leave: no session tokens, OAuth tokens,
 * passkey public keys or credential ids.
 */
export const EXPORT_QUERIES = {
  user: `SELECT id, name, email, "emailVerified" AS email_verified, image, "createdAt" AS created_at
         FROM "user" WHERE id = $1`,
  profile: `SELECT phone, address_line1, address_line2, postal_code, city, country, updated_at
            FROM guest_profile WHERE user_id = $1`,
  accounts: `SELECT "providerId" AS provider, "createdAt" AS created_at FROM account WHERE "userId" = $1 ORDER BY "createdAt"`,
  passkeys: `SELECT name, "deviceType" AS device_type, "backedUp" AS backed_up, "createdAt" AS created_at
             FROM passkey WHERE "userId" = $1 ORDER BY "createdAt"`,
  sessions: `SELECT "createdAt" AS signed_in_at, "updatedAt" AS last_active_at, "expiresAt" AS expires_at,
                    "ipAddress" AS ip_address, "userAgent" AS user_agent
             FROM session WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
  bookings: `SELECT b.id, b.status, b.check_in_date::text AS check_in_date, b.check_out_date::text AS check_out_date,
                    b.total_amount, b.currency, b.guest_notes, b.cancellation_reason, b.cancelled_at,
                    b.confirmed_at, b.created_at, p.name AS property, p.city,
                    COALESCE((SELECT json_agg(json_build_object(
                      'room', rm.name, 'adults', r.adults, 'children', r.children, 'nights', r.nights,
                      'cancellation_tier', r.cancellation_tier, 'cancelled_at', r.cancelled_at
                    ) ORDER BY r.created_at) FROM reservations r JOIN rooms rm ON rm.id = r.room_id
                    WHERE r.booking_id = b.id), '[]'::json) AS rooms,
                    COALESCE((SELECT json_agg(json_build_object(
                      'amount', rf.amount, 'reason', rf.reason, 'status', rf.status, 'created_at', rf.created_at
                    ) ORDER BY rf.created_at) FROM refunds rf WHERE rf.booking_id = b.id), '[]'::json) AS refunds
             FROM bookings b JOIN properties p ON p.id = b.hotel_id
             WHERE b.user_id = $1 AND b.status <> 'pending'
             ORDER BY b.check_in_date DESC`,
  conversations: `SELECT t.id, p.name AS property, t.booking_id, t.status, t.created_at,
                         COALESCE((SELECT json_agg(json_build_object(
                           'from', CASE WHEN m.sender_role = 'guest' THEN 'you' ELSE 'property' END,
                           'body', m.body, 'sent_at', m.created_at
                         ) ORDER BY m.created_at) FROM messages m WHERE m.thread_id = t.id), '[]'::json) AS messages
                  FROM message_threads t JOIN properties p ON p.id = t.property_id
                  WHERE t.guest_id = $1 ORDER BY t.created_at`,
  consent: `SELECT event_type, categories, banner_version, app, created_at, expires_at
            FROM consent_log WHERE user_id = $1 ORDER BY created_at`,
} as const;

export type GuestExport = {
  exportedAt: string;
  account: unknown;
  contactDetails: unknown;
  signInMethods: unknown[];
  passkeys: unknown[];
  sessions: unknown[];
  bookings: unknown[];
  conversations: unknown[];
  consentRecords: unknown[];
};

export async function buildGuestExport(userId: string, run: Run, now: Date = new Date()): Promise<GuestExport> {
  const q = (sql: string) => run(sql, [userId]);
  const [user, profile, accounts, passkeys, sessions, bookings, conversations, consent] = await Promise.all([
    q(EXPORT_QUERIES.user),
    q(EXPORT_QUERIES.profile),
    q(EXPORT_QUERIES.accounts),
    q(EXPORT_QUERIES.passkeys),
    q(EXPORT_QUERIES.sessions),
    q(EXPORT_QUERIES.bookings),
    q(EXPORT_QUERIES.conversations),
    q(EXPORT_QUERIES.consent),
  ]);
  return {
    exportedAt: now.toISOString(),
    account: user[0] ?? null,
    contactDetails: profile[0] ?? null,
    signInMethods: accounts,
    passkeys,
    sessions,
    bookings,
    conversations,
    consentRecords: consent,
  };
}
