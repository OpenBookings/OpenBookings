import { redirect } from "next/navigation";
import { queryOne } from "@openbookings/db";
import { ROLE_INFO, roleLabel } from "@openbookings/authz/role-guide";
import type { HostRole } from "@openbookings/authz/permissions";
import { getServerSession } from "@/lib/auth";
import { InviteButtons, SwitchAccountButton } from "./invite-buttons";

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  expired: boolean;
  org_name: string;
  inviter: string | null;
};

/**
 * Where an invitation email leads. Signing in first is the proxy's job (it
 * sends the person to /login and back here). The invitation's details are
 * shown only to the person it was sent to: anyone else holding the link
 * learns nothing about the organisation.
 */
export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/login?redirect=${encodeURIComponent(`/invite/${id}`)}`);

  const invitation = await queryOne<InvitationRow>(
    `SELECT i.id, i.email, i.role, i.status, (i."expiresAt" <= now()) AS expired,
            o.name AS org_name,
            COALESCE(NULLIF(trim(u.name), ''), u.email) AS inviter
     FROM "invitation" i
     JOIN "organization" o ON o.id = i."organizationId"
     LEFT JOIN "user" u ON u.id = i."inviterId"
     WHERE i.id = $1`,
    [id],
  ).catch(() => null);

  const forYou = invitation && invitation.email.toLowerCase() === session.user.email.toLowerCase();
  const open = invitation && invitation.status === "pending" && !invitation.expired;

  let content: React.ReactNode;
  if (invitation && !forYou) {
    content = (
      <>
        <h1 className="text-2xl font-medium">This invitation is for someone else</h1>
        <p className="text-muted-foreground">
          You&apos;re signed in as {session.user.email}, but the invitation was sent to a different email address.
          Sign in with the address it was sent to.
        </p>
        <SwitchAccountButton invitationId={id} />
      </>
    );
  } else if (!invitation || !open) {
    content = (
      <>
        <h1 className="text-2xl font-medium">This invitation isn&apos;t open any more</h1>
        <p className="text-muted-foreground">
          {invitation?.status === "accepted"
            ? "It has already been accepted."
            : "It has expired, been withdrawn or was declined. Ask the person who invited you to send a new one."}
        </p>
        {invitation?.status === "accepted" ? (
          <a href="/dashboard" className="underline underline-offset-2">
            Go to the dashboard
          </a>
        ) : null}
      </>
    );
  } else {
    const info = invitation.role in ROLE_INFO ? ROLE_INFO[invitation.role as HostRole] : null;
    content = (
      <>
        <h1 className="text-2xl font-medium">Join {invitation.org_name}</h1>
        <p className="text-muted-foreground">
          {invitation.inviter ?? "Someone"} invited you to join {invitation.org_name} on OpenBookings as{" "}
          <span className="font-medium text-foreground">{roleLabel(invitation.role)}</span>.
        </p>
        {info ? (
          <div className="rounded-lg border p-4 text-sm">
            <p>{info.summary}</p>
            <p className="mt-1 text-muted-foreground">{info.scope}</p>
          </div>
        ) : null}
        <InviteButtons invitationId={invitation.id} />
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="flex w-full max-w-md flex-col gap-4">{content}</div>
    </main>
  );
}
