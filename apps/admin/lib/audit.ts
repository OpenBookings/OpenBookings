import type { Queryable } from "./staff";

export type AuditRow = {
  id: string;
  at: Date;
  action: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  stepUp: string | null;
  outcome: string | null;
};

const LIMIT = 200;

/** The latest admin audit rows (action 'admin.*', outcome rows included), newest first; optionally one target's. */
export async function listAdminAudit(db: Queryable, target?: string): Promise<AuditRow[]> {
  const { rows } = await db.query(
    `SELECT id, created_at, action, reason, detail
       FROM audit_log
      WHERE action LIKE 'admin.%'
        AND ($1::text IS NULL OR detail->>'target_id' = $1)
      ORDER BY created_at DESC, id DESC
      LIMIT ${LIMIT}`,
    [target?.trim() || null],
  );
  return rows.map((r) => {
    const d = (r.detail ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : v == null ? null : JSON.stringify(v));
    return {
      id: String(r.id),
      at: r.created_at as Date,
      action: String(r.action),
      actorEmail: str(d.actor_email),
      targetType: str(d.target_type),
      targetId: str(d.target_id),
      reason: (r.reason as string | null) ?? null,
      stepUp: str(d.step_up),
      outcome: str(d.error) ?? str(d.refusal),
    };
  });
}
