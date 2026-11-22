import { PageHold } from "@/components/dashboard/page-loaders";
import { redirect } from "next/navigation";
import { roleLabel } from "@openbookings/authz/role-guide";
import { PageHeader, SectionHeader } from "@/components/dashboard/page-header";
import { SiteHeader } from "@/components/dashboard/site-header";
import { Card } from "@/components/ui/card";
import { getServerSession } from "@/lib/auth";
import { pageAccess } from "@/lib/page-access";
import { NoAccessPage } from "@/components/dashboard/no-access-page";
import { loadTeam, stepUpFactors, teamScope } from "@/lib/team/server";
import { RoleGuide } from "./_components/role-guide";
import { TeamManager } from "./_components/team-manager";

/**
 * Who is on the team, and what each role means. Owners and general managers
 * get two tabs, People (add, change and remove people) and Roles; everyone
 * else sees their own role and the roles table, but not their colleagues.
 * That split is the rule table's "edit" and "view" for the team page
 * (@openbookings/authz/nav-access; page-access.test.ts keeps canManageTeam
 * in step with it).
 */
export default async function TeamPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const access = await pageAccess("team");
  if (access.level === "none") {
    return (
      <>
        <SiteHeader title="Team" />
        <div className="flex min-h-0 flex-1 flex-col py-4 md:py-6">
          <PageHold id="team" fill>
            <NoAccessPage navKey="team" current={access.current} />
          </PageHold>
        </div>
      </>
    );
  }
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
      <Card className="gap-0 p-5">
        <SectionHeader
          title={`Your role at ${scope.orgName}: ${roleLabel(scope.role)}`}
          description="Owners and general managers add people and change roles. Ask one of them if you need more access."
        />
      </Card>
    );
  }

  return (
    <>
      <SiteHeader title="Team" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-6">
            <PageHold id="team">
              <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6">
                <PageHeader
                  title="Team"
                  description={
                    scope?.canManage
                      ? "Invite the people who help you run your property, and choose what each of them can do."
                      : "See your own role and what each role on the team can do."
                  }
                />
                <div className="flex flex-col gap-10">
                  {body}
                  {scope?.canManage ? null : <RoleGuide currentRole={scope?.role} />}
                </div>
              </div>
            </PageHold>
          </div>
        </div>
      </div>
    </>
  );
}
