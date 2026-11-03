"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, getServerSession } from "@/lib/auth";

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

export async function acceptInvite(invitationId: string): Promise<InviteResult> {
  if (!(await getServerSession())) redirect(`/login?redirect=${encodeURIComponent(`/invite/${invitationId}`)}`);
  try {
    await auth.api.acceptInvitation({ headers: await headers(), body: { invitationId } });
  } catch (error) {
    return { error: message(error) };
  }
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
