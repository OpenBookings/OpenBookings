import { Check, Minus } from "lucide-react";
import { ROLE_INFO, ROLE_ORDER, roleAbilities } from "@openbookings/authz/role-guide";
import { Badge } from "@/components/ui/badge";

/**
 * What each role can and can't do. The lists are worked out from the same
 * grants the server enforces (packages/authz), so this page can't drift
 * from what actually happens.
 */
export function RoleGuide({ currentRole }: { currentRole?: string | null }) {
  return (
    <section aria-labelledby="roles-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="roles-heading" className="text-lg font-medium">
          Roles
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Give everyone the role that matches their job. The owner and the general manager can be the same
          person: an owner already has everything a general manager has. Roles that cover only some
          properties see and act on just those.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ROLE_ORDER.map((role) => {
          const info = ROLE_INFO[role];
          const { can, cannot } = roleAbilities(role);
          return (
            <article key={role} className="flex flex-col gap-3 rounded-lg border p-4">
              <header className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{info.label}</h3>
                  {currentRole === role ? <Badge variant="secondary">Your role</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">{info.scope}</p>
              </header>
              <p className="text-sm text-muted-foreground">{info.summary}</p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {can.map((label) => (
                  <li key={label} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                    <span>
                      <span className="sr-only">Can: </span>
                      {label}
                    </span>
                  </li>
                ))}
                {cannot.map((label) => (
                  <li key={label} className="flex gap-2 text-muted-foreground">
                    <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      <span className="sr-only">Can&apos;t: </span>
                      {label}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}
