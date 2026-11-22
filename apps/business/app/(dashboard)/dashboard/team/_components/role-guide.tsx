"use client";

import * as React from "react";
import { Check, Info, Minus, Slash } from "lucide-react";
import { isPropertyScoped, type HostRole } from "@openbookings/authz/permissions";
import { ABILITIES, ABILITY_GROUPS, ROLE_INFO, ROLE_ORDER, roleHas } from "@openbookings/authz/role-guide";
import { SectionHeader, SectionLabel } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const isRole = (role: string | null | undefined): role is HostRole => !!role && role in ROLE_INFO;

const PROPERTIES_HELP =
  "A tick means the role covers every property. An orange slash means it only covers the properties you pick for each person.";

/**
 * What each role can and can't do, as one table to compare them. The ticks
 * are worked out from the same grants the server enforces (packages/authz),
 * so this page can't drift from what actually happens. Phones, where six
 * columns don't fit, get one role at a time.
 */
export function RoleGuide({
  currentRole,
  inTab = false,
}: {
  currentRole?: string | null;
  /** Under a "Roles" tab, the visible heading would repeat the tab. */
  inTab?: boolean;
}) {
  const yours = isRole(currentRole) ? currentRole : null;
  return (
    <TooltipProvider delayDuration={150}>
      <section aria-label="Roles" className="flex flex-col gap-4">
        <SectionHeader
          title={inTab ? <span className="sr-only">Roles</span> : "Roles"}
          description={
            <span className="block max-w-2xl">
              Pick the role that matches the job. An owner already has everything a general manager has, so one
              person running the hotel needs only the owner role.
            </span>
          }
        />
        <RoleMatrix yours={yours} />
        <RolePicker yours={yours} />
      </section>
    </TooltipProvider>
  );
}

/** "All properties", with what the tick and the slash mean. */
function PropertiesLabel() {
  return (
    <span className="inline-flex items-center gap-1.5">
      All properties
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="What the tick and slash mean"
            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{PROPERTIES_HELP}</TooltipContent>
      </Tooltip>
    </span>
  );
}

function RoleMatrix({ yours }: { yours: HostRole | null }) {
  const cell = (role: HostRole) => cn("px-3 py-2.5 text-center", role === yours && "bg-accent");
  return (
    <div className="hidden overflow-hidden rounded-xl border md:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <caption className="sr-only">What each role can do</caption>
          <thead>
            <tr className="border-b align-bottom">
              <th scope="col" className="w-[32%] px-4 py-3 text-left font-normal">
                <span className="sr-only">Ability</span>
              </th>
              {ROLE_ORDER.map((role) => (
                <th key={role} scope="col" className={cn(cell(role), "pt-3 font-medium")}>
                  {role === yours ? (
                    <Badge variant="secondary" className="mb-1.5">
                      Your role
                    </Badge>
                  ) : null}
                  <span className="block">{ROLE_INFO[role].label}</span>
                </th>
              ))}
            </tr>
            <tr className="border-b">
              <th scope="row" className="px-4 py-2.5 text-left font-normal">
                <PropertiesLabel />
              </th>
              {ROLE_ORDER.map((role) => (
                <td key={role} className={cell(role)}>
                  <Coverage all={!isPropertyScoped(role)} />
                </td>
              ))}
            </tr>
          </thead>
          {ABILITY_GROUPS.map((group) => (
            <tbody key={group}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={ROLE_ORDER.length + 1}
                  className="border-b px-4 pt-5 pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {group}
                </th>
              </tr>
              {ABILITIES.filter((a) => a.group === group).map((ability) => (
                <tr key={ability.label} className="border-b last:border-b-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">
                    {ability.label}
                    {ability.hint ? <span className="block text-xs text-muted-foreground">{ability.hint}</span> : null}
                  </th>
                  {ROLE_ORDER.map((role) => (
                    <td key={role} className={cell(role)}>
                      <Allowed yes={roleHas(role, ability.permission)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

function Allowed({ yes }: { yes: boolean }) {
  return yes ? (
    <>
      <Check className="mx-auto size-4 text-state-positive" aria-hidden />
      <span className="sr-only">Yes</span>
    </>
  ) : (
    <>
      <Minus className="mx-auto size-4 text-(--gray-6)" aria-hidden />
      <span className="sr-only">No</span>
    </>
  );
}

/** A tick for every property, an orange slash for only the chosen ones. */
function Coverage({ all, className }: { all: boolean; className?: string }) {
  return all ? (
    <>
      <Check className={cn("mx-auto size-4 text-state-positive", className)} aria-hidden />
      <span className="sr-only">All properties</span>
    </>
  ) : (
    <>
      <Slash className={cn("mx-auto size-4 text-state-attention", className)} aria-hidden />
      <span className="sr-only">Only chosen properties</span>
    </>
  );
}

function RolePicker({ yours }: { yours: HostRole | null }) {
  const [role, setRole] = React.useState<HostRole>(yours ?? ROLE_ORDER[0]);
  const info = ROLE_INFO[role];
  const all = !isPropertyScoped(role);
  return (
    <div className="flex flex-col gap-4 md:hidden">
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={2}
        value={role}
        onValueChange={(next) => isRole(next) && setRole(next)}
        aria-label="Pick a role to see what it can do"
        className="-mx-4 w-auto justify-start overflow-x-auto px-4 pb-1"
      >
        {ROLE_ORDER.map((choice) => (
          <ToggleGroupItem key={choice} value={choice} className="whitespace-nowrap">
            {ROLE_INFO[choice].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{info.label}</h3>
          {role === yours ? <Badge variant="secondary">Your role</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">{info.summary}</p>
      </div>
      <p className="flex items-center gap-2 text-sm">
        <Coverage all={all} className="mx-0 shrink-0" />
        <span aria-hidden>{all ? "All properties" : "Only the properties you pick"}</span>
      </p>
      {ABILITY_GROUPS.map((group) => (
        <div key={group} className="flex flex-col gap-1.5">
          <SectionLabel as="h4">{group}</SectionLabel>
          <ul className="flex flex-col gap-1.5 text-sm">
            {ABILITIES.filter((a) => a.group === group).map((ability) => {
              const yes = roleHas(role, ability.permission);
              return (
                <li key={ability.label} className={cn("flex gap-2", !yes && "text-muted-foreground")}>
                  {yes ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-state-positive" aria-hidden />
                  ) : (
                    <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />
                  )}
                  <span>
                    <span className="sr-only">{yes ? "Can: " : "Can't: "}</span>
                    {ability.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
