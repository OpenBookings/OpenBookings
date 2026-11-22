"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { captureOutcome } from "@openbookings/mailing/tracking";
import { listSwitchableProperties, setCurrentProperty } from "@openbookings/authz";
import { auth, getServerSession } from "@/lib/auth";
import { currentPropertyFor } from "@/lib/current-property";

/**
 * Accept or decline an invitation. Better Auth checks that it is still open
 * and addressed to the signed-in user's email; the org plugin hook then
 * copies the invitation's properties into property_access.
 */

export type InviteResult = { error: string } | undefined;

function message(error: unknown): string {
  const body = (error as { body?: { message?: unknown } } | null)?.body;
  return typeof body?.message === "string" ? body.message : "Something went wrong. Please try again.";
}

/**
 * Point the session at the first hotel the new member can read in the invited
 * org. With none yet (a property-scoped role not assigned to a hotel), the
 * previous hotel is re-applied (both pointers). Never blocks the redirect.
 */
async function landInInvitedHotel(
  session: { user: { id: string }; session: { id?: unknown } },
  organizationId: string | null,
  previousPropertyId: string | null,
) {
  const sessionId = session.session.id;
  if (typeof sessionId !== "string" || !sessionId) return;
  try {
    const first = (await listSwitchableProperties(session.user.id)).find((h) => h.organizationId === organizationId);
    const target = (organizationId ? first?.propertyId : null) ?? previousPropertyId;
    // No readable hotel in the invited org: re-apply the previous hotel, which
    // also restores activeOrganizationId that acceptInvitation overwrote.
    if (target) await setCurrentProperty({ userId: session.user.id, sessionId }, target);
  } catch (error) {
    console.error("[invite] landing in the invited hotel failed:", error instanceof Error ? error.message : error);
  }
}

export async function acceptInvite(invitationId: string): Promise<InviteResult> {
  const session = await getServerSession();
  if (!session) redirect(`/login?redirect=${encodeURIComponent(`/invite/${invitationId}`)}`);
  // Better Auth's acceptInvitation sets activeOrganizationId to the invited org
  // but leaves activePropertyId alone, so remember where the member was.
  const previous = await currentPropertyFor(session as Parameters<typeof currentPropertyFor>[0]).catch(() => null);
  let invitedOrgId: string | null = null;
  try {
    const accepted = await auth.api.acceptInvitation({ headers: await headers(), body: { invitationId } });
    invitedOrgId = (accepted as { invitation?: { organizationId?: unknown } } | null)?.invitation?.organizationId as string | null ?? null;
  } catch (error) {
    return { error: message(error) };
  }
  await landInInvitedHotel(session, invitedOrgId, previous?.propertyId ?? null);
  // Consent-gated like every outcome: the invitee is signed in by now.
  const userId = session.user.id;
  after(() => captureOutcome("team_invitation_accepted", { userId }));
  redirect("/dashboard");
}

export async function declineInvite(invitationId: string): Promise<InviteResult> {
  if (!(await getServerSession())) redirect("/login");
  try {
    await auth.api.rejectInvitation({ headers: await headers(), body: { invitationId } });
  } catch (error) {
    return { error: message(error) };
  }
  redirect(`/invite/${encodeURIComponent(invitationId)}`);
}
