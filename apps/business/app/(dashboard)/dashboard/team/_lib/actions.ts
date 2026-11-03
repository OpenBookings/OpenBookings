"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { query, withTransaction } from "@openbookings/db";
import { auth, getServerSession } from "@/lib/auth";
import { checkAssignment, checkTarget, TEAM_ERRORS, type TeamError } from "@/lib/team/rules";
import { teamScope, type TeamScope } from "@/lib/team/server";

/**
 * The Team page's actions. Every one re-derives the org and the actor's role
 * from the session (teamScope) and trusts the client for ids only.
 *
 * Membership itself — inviting, changing roles, removing — goes through
 * Better Auth's organization endpoints, so its rules hold here too (only
 * owners make or touch owners, the last owner stays) and so does the
 * step-up gate on invite, remove and promotions to owner or general manager.
 * Which properties a member covers is ours: property_access, written here.
 *
 * Results use the `{ error }` shape the step-up dialog understands, so a
 * STEP_UP_REQUIRED refusal turns into a prompt rather than an error.
 */

/**
 * `ok` is what says it worked: the step-up dialog reports a cancelled
 * verification as `{ error: null }` too, which must not read as success.
 */
export type TeamResult = { ok: boolean; error: { code: string; message: string } | null };

const OK: TeamResult = { ok: true, error: null };
const TEAM_PATH = "/dashboard/team";

function fail(code: TeamError): TeamResult {
  return { ok: false, error: { code, message: TEAM_ERRORS[code] } };
}

/** Better Auth throws APIError; keep its code (STEP_UP_REQUIRED matters) and message. */
function fromAuthError(error: unknown): TeamResult {
  const body = (error as { body?: { code?: unknown; message?: unknown } } | null)?.body;
  const code = typeof body?.code === "string" ? body.code : "FAILED";
  const message =
    typeof body?.message === "string"
      ? body.message
      : error instanceof Error && error.message
        ? error.message
        : "Something went wrong. Please try again.";
  return { ok: false, error: { code, message } };
}

async function managerScope(): Promise<TeamScope | null> {
  const session = await getServerSession();
  const scope = await teamScope(session);
  return scope?.canManage ? scope : null;
}

async function orgPropertyIds(scope: TeamScope): Promise<string[]> {
  const rows = await scope.db.query<{ id: string }>(
    `SELECT id::text AS id FROM properties WHERE organization_id = $1`,
  );
  return rows.map((row) => row.id);
}

async function audit(scope: TeamScope, action: string, targetUserId: string | null, detail: object) {
  await query(
    `INSERT INTO audit_log (action, actor_user_id, target_user_id, organization_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [action, scope.userId, targetUserId, scope.orgId, JSON.stringify(detail)],
  ).catch((error) => {
    // The change is made; failing the request would only hide it.
    console.error("[team] audit write failed:", error instanceof Error ? error.message : error);
  });
}

const inviteInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.string(),
  propertyIds: z.array(z.string()).max(500),
});

export async function inviteMember(input: z.input<typeof inviteInput>): Promise<TeamResult> {
  const scope = await managerScope();
  if (!scope) return fail("not_allowed");
  const parsed = inviteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_email", message: "Enter a valid email address." } };

  const checked = checkAssignment({
    actorRole: scope.role,
    role: parsed.data.role,
    propertyIds: parsed.data.propertyIds,
    orgPropertyIds: await orgPropertyIds(scope),
  });
  if (!checked.ok) return fail(checked.error);

  let invitationId: string;
  try {
    const invitation = await auth.api.createInvitation({
      headers: await headers(),
      body: { email: parsed.data.email, role: checked.role, organizationId: scope.orgId },
    });
    invitationId = invitation.id;
  } catch (error) {
    return fromAuthError(error);
  }

  if (checked.propertyIds.length > 0) {
    try {
      await query(
        `INSERT INTO invitation_property_access (invitation_id, property_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [invitationId, checked.propertyIds],
      );
    } catch (error) {
      // An invitation without its properties would give a scoped member
      // nothing. Withdraw it rather than leave it half made.
      await auth.api
        .cancelInvitation({ headers: await headers(), body: { invitationId } })
        .catch(() => undefined);
      console.error("[team] invitation properties failed:", error instanceof Error ? error.message : error);
      return { ok: false, error: { code: "FAILED", message: "Couldn't send the invitation. Please try again." } };
    }
  }

  await audit(scope, "member.invited", null, {
    invitationId,
    email: parsed.data.email,
    role: checked.role,
    propertyIds: checked.propertyIds,
  });
  revalidatePath(TEAM_PATH);
  return OK;
}

const updateInput = z.object({
  memberId: z.string().min(1),
  role: z.string(),
  propertyIds: z.array(z.string()).max(500),
});

/**
 * Change a member's role, the properties they cover, or both. The role goes
 * through Better Auth first; if it refuses (step-up, an owner rule), nothing
 * else changes.
 */
export async function updateMember(input: z.input<typeof updateInput>): Promise<TeamResult> {
  const scope = await managerScope();
  if (!scope) return fail("not_allowed");
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) return fail("unknown_role");

  const target = await scope.db.queryOne<{ userId: string; role: string }>(
    `SELECT "userId", role FROM "member" WHERE "organizationId" = $1 AND id = $2`,
    [parsed.data.memberId],
  );
  if (!target) return { ok: false, error: { code: "not_found", message: "That person isn't on your team any more." } };
  const targetError = checkTarget({
    actorUserId: scope.userId,
    actorRole: scope.role,
    targetUserId: target.userId,
    targetRole: target.role,
  });
  if (targetError) return fail(targetError);

  const checked = checkAssignment({
    actorRole: scope.role,
    role: parsed.data.role,
    propertyIds: parsed.data.propertyIds,
    orgPropertyIds: await orgPropertyIds(scope),
  });
  if (!checked.ok) return fail(checked.error);

  if (checked.role !== target.role) {
    try {
      await auth.api.updateMemberRole({
        headers: await headers(),
        body: { memberId: parsed.data.memberId, role: checked.role, organizationId: scope.orgId },
      });
    } catch (error) {
      return fromAuthError(error);
    }
  }

  // Replace the member's property list in one transaction. The member row is
  // checked against this org again inside it, so a member removed in the
  // meantime gets nothing.
  await withTransaction(async (tx) => {
    await tx.query(`DELETE FROM property_access WHERE member_id = $1`, [parsed.data.memberId]);
    if (checked.propertyIds.length > 0) {
      await tx.query(
        `INSERT INTO property_access (member_id, property_id)
         SELECT m.id, unnest($3::uuid[])
         FROM "member" m WHERE m.id = $1 AND m."organizationId" = $2`,
        [parsed.data.memberId, scope.orgId, checked.propertyIds],
      );
    }
  });

  await audit(scope, "member.updated", target.userId, {
    memberId: parsed.data.memberId,
    fromRole: target.role,
    role: checked.role,
    propertyIds: checked.propertyIds,
  });
  revalidatePath(TEAM_PATH);
  return OK;
}

export async function removeMember(memberId: string): Promise<TeamResult> {
  const scope = await managerScope();
  if (!scope) return fail("not_allowed");
  if (typeof memberId !== "string" || !memberId) return fail("not_allowed");

  const target = await scope.db.queryOne<{ userId: string; role: string }>(
    `SELECT "userId", role FROM "member" WHERE "organizationId" = $1 AND id = $2`,
    [memberId],
  );
  if (!target) return OK; // Already gone.
  const targetError = checkTarget({
    actorUserId: scope.userId,
    actorRole: scope.role,
    targetUserId: target.userId,
    targetRole: target.role,
  });
  if (targetError) return fail(targetError);

  try {
    // Removing a member cascades their property_access rows away, and the
    // org plugin hook signs them out everywhere.
    await auth.api.removeMember({
      headers: await headers(),
      body: { memberIdOrEmail: memberId, organizationId: scope.orgId },
    });
  } catch (error) {
    return fromAuthError(error);
  }

  await audit(scope, "member.removed", target.userId, { memberId, role: target.role });
  revalidatePath(TEAM_PATH);
  return OK;
}

export async function cancelInvitation(invitationId: string): Promise<TeamResult> {
  const scope = await managerScope();
  if (!scope) return fail("not_allowed");
  if (typeof invitationId !== "string" || !invitationId) return fail("not_allowed");

  const invitation = await scope.db.queryOne<{ id: string }>(
    `SELECT id FROM "invitation" WHERE "organizationId" = $1 AND id = $2 AND status = 'pending'`,
    [invitationId],
  );
  if (!invitation) return OK; // Already accepted, declined or withdrawn.

  try {
    await auth.api.cancelInvitation({ headers: await headers(), body: { invitationId } });
  } catch (error) {
    return fromAuthError(error);
  }

  await audit(scope, "member.invitation-cancelled", null, { invitationId });
  revalidatePath(TEAM_PATH);
  return OK;
}
