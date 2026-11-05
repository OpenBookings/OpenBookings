import { redirect } from "next/navigation";
import { roleLabel } from "@openbookings/authz/role-guide";
import { SiteHeader } from "@/components/dashboard/site-header";
import { getServerSession } from "@/lib/auth";
import { loadTeam, stepUpFactors, teamScope } from "@/lib/team/server";
import { RoleGuide } from "./_components/role-guide";
import { TeamManager } from "./_components/team-manager";

/**
 * Who is on the team, and what each role means. Owners and general managers
 * get two tabs, People (add, change and remove people) and Roles; everyone
 * else sees their own role and the roles table, but not their colleagues.
 */
export default async function TeamPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const scope = await teamScope(session);

  let body: React.ReactNode;
  if (!scope) {
    body = (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t work out which organisation you&apos;re in. Sign out and back in, or contact support.
      </p>
    );
  } else if (scope.canManage) {
    const [team, factors] = await Promise.all([loadTeam(scope), stepUpFactors(scope)]);
    body = (
      <TeamManager
        team={team}
        actorRole={scope.role}
        actorUserId={scope.userId}
        factors={factors}
        rolesPanel={<RoleGuide currentRole={scope.role} inTab />}
      />
    );
  } else {
    body = (
      <section className="flex flex-col gap-1 rounded-lg border p-4">
        <h2 className="font-medium">
          Your role at {scope.orgName}: {roleLabel(scope.role)}
        </h2>
        <p className="text-sm text-muted-foreground">
          Owners and general managers add people and change roles. Ask one of them if you need more access.
        </p>
      </section>
    );
  }

  return (
    <>
      <SiteHeader title="Team" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-6">
            <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-10">
              {body}
              {scope?.canManage ? null : <RoleGuide currentRole={scope?.role} />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
