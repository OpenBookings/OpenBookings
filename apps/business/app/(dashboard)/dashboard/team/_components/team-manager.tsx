"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { isPropertyScoped, type HostRole } from "@openbookings/authz/permissions";
import { ROLE_INFO, ROLE_ORDER, assignableRoles, roleLabel } from "@openbookings/authz/role-guide";
import { useStepUp } from "@/components/security/step-up-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Team, TeamMember } from "@/lib/team/server";
import { cancelInvitation, inviteMember, removeMember, updateMember, type TeamResult } from "../_lib/actions";

const dateLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

type Editing =
  | { kind: "invite" }
  | { kind: "edit"; member: TeamMember }
  | { kind: "remove"; member: TeamMember }
  | null;

/**
 * Adding, changing and removing people, for owners and general managers.
 * What this shows is a convenience: every action is re-checked on the server,
 * and the sensitive ones ask for a fresh passkey or code first.
 */
export function TeamManager({
  team,
  actorRole,
  actorUserId,
  factors,
  rolesPanel,
}: {
  team: Team;
  actorRole: string;
  actorUserId: string;
  factors: { hasPasskey: boolean; hasAuthenticator: boolean };
  /** The Roles tab. */
  rolesPanel: React.ReactNode;
}) {
  const router = useRouter();
  const { guard, dialog: stepUpDialog } = useStepUp(factors);
  const [editing, setEditing] = React.useState<Editing>(null);
  const [busy, setBusy] = React.useState(false);
  const [tab, setTab] = React.useState("people");
  const roles = assignableRoles(actorRole);
  const actorIsOwner = roles.includes("owner");
  const propertyName = React.useMemo(
    () => new Map(team.properties.map((p) => [p.id, p.name])),
    [team.properties],
  );

  /** Runs an action behind the step-up gate; true when it went through. */
  async function perform(action: () => Promise<TeamResult>, success: string): Promise<boolean> {
    setBusy(true);
    try {
      const result = (await guard(action)) as Partial<TeamResult> | null | undefined;
      if (!result?.ok) {
        // A cancelled verification comes back as `{ error: null }`: no toast.
        if (result?.error?.message) toast.error(result.error.message);
        return false;
      }
      toast.success(success);
      router.refresh();
      return true;
    } catch {
      toast.error("Something went wrong. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function scopeChips(role: string, propertyIds: string[]): React.ReactNode {
    if (!(role in ROLE_INFO) || !isPropertyScoped(role as HostRole)) {
      return <span className="text-sm text-muted-foreground">All properties</span>;
    }
    if (propertyIds.length === 0) return <span className="text-sm text-muted-foreground">No properties yet</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {propertyIds.map((id) => (
          <Badge key={id} variant="outline" className="font-normal">
            {propertyName.get(id) ?? "Removed property"}
          </Badge>
        ))}
      </span>
    );
  }

  const canTouch = (member: TeamMember) =>
    member.userId !== actorUserId && (actorIsOwner || !member.role.split(",").includes("owner"));
  const justYou = team.members.length === 1 && team.invitations.length === 0;

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b">
        <TabsList variant="line" className="h-auto p-0">
          <TabsTrigger value="people" className="px-3 pb-2.5">
            People <span className="text-xs text-muted-foreground tabular-nums">{team.members.length + team.invitations.length}</span>
          </TabsTrigger>
          <TabsTrigger value="roles" className="px-3 pb-2.5">
            Roles
          </TabsTrigger>
        </TabsList>
        <Button size="sm" className="mb-2" onClick={() => setEditing({ kind: "invite" })} disabled={busy}>
          <UserPlus /> Invite someone
        </Button>
      </div>

      <TabsContent value="roles">{rolesPanel}</TabsContent>

      <TabsContent value="people">
    <section aria-labelledby="people-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="people-heading" className="sr-only">
          People
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Everyone who can sign in to this organisation, and what they can reach.
        </p>
      </div>

      {justYou ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          It&apos;s just you for now. As {roleLabel(actorRole).toLowerCase()} you already have everything a
          general manager can do, so there&apos;s nobody else you need to add. Invite people when you want help
          at the desk, with reservations or with the books.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Properties</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.members.map((member) => (
              <TableRow key={member.memberId}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {member.name}
                      {member.userId === actorUserId ? <span className="text-muted-foreground"> (you)</span> : null}
                    </span>
                    {member.name !== member.email ? (
                      <span className="text-xs text-muted-foreground">{member.email}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{roleLabel(member.role)}</Badge>
                </TableCell>
                <TableCell className="max-w-[20rem] whitespace-normal">
                  {scopeChips(member.role, member.propertyIds)}
                </TableCell>
                <TableCell className="text-right">
                  {canTouch(member) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit ${member.name}'s access`}
                      disabled={busy}
                      onClick={() => setEditing({ kind: "edit", member })}
                    >
                      Edit
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {team.invitations.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Waiting to accept</h3>
          <ul className="flex flex-col divide-y rounded-lg border">
            {team.invitations.map((invitation) => (
              <li key={invitation.invitationId} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{invitation.email}</span>
                <Badge variant="outline">{roleLabel(invitation.role)}</Badge>
                {scopeChips(invitation.role, invitation.propertyIds)}
                <span className="text-muted-foreground">
                  Open until {dateLabel.format(new Date(invitation.expiresAt))}
                </span>
                {actorIsOwner || invitation.role !== "owner" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => perform(() => cancelInvitation(invitation.invitationId), "Invitation withdrawn")}
                  >
                    Withdraw
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

    </section>
      </TabsContent>

      <AccessDialog
        key={editing?.kind === "edit" ? editing.member.memberId : editing?.kind ?? "closed"}
        open={editing?.kind === "invite" || editing?.kind === "edit"}
        member={editing?.kind === "edit" ? editing.member : null}
        roles={roles}
        properties={team.properties}
        busy={busy}
        onClose={() => !busy && setEditing(null)}
        onCompareRoles={() => {
          if (busy) return;
          setEditing(null);
          setTab("roles");
        }}
        onRemove={
          editing?.kind === "edit" && canTouch(editing.member)
            ? () => setEditing({ kind: "remove", member: editing.member })
            : undefined
        }
        onSubmit={async (values) => {
          const done =
            editing?.kind === "edit"
              ? await perform(
                  () => updateMember({ memberId: editing.member.memberId, role: values.role, propertyIds: values.propertyIds }),
                  "Access updated",
                )
              : await perform(
                  () => inviteMember({ email: values.email, role: values.role, propertyIds: values.propertyIds }),
                  `Invitation sent to ${values.email}`,
                );
          if (done) setEditing(null);
        }}
      />

      <AlertDialog open={editing?.kind === "remove"} onOpenChange={(open) => !open && !busy && setEditing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {editing?.kind === "remove" ? editing.member.name : "this person"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They are signed out everywhere and lose access straight away. Their bookings history and
              messages stay with your organisation. You can invite them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep them</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={async (event) => {
                event.preventDefault();
                if (editing?.kind !== "remove") return;
                const member = editing.member;
                if (await perform(() => removeMember(member.memberId), `${member.name} removed`)) setEditing(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {stepUpDialog}
    </Tabs>
  );
}

function AccessDialog(props: {
  open: boolean;
  member: TeamMember | null;
  roles: HostRole[];
  properties: Team["properties"];
  busy: boolean;
  onClose: () => void;
  onCompareRoles: () => void;
  /** Set when the person may be removed: opens the remove confirmation. */
  onRemove?: () => void;
  onSubmit: (values: { email: string; role: string; propertyIds: string[] }) => void;
}) {
  const { member, properties } = props;
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<string>(member?.role ?? "frontdesk");
  // With one property there is nothing to choose: start with it ticked.
  const [selected, setSelected] = React.useState<string[]>(
    member ? member.propertyIds : properties.length === 1 ? [properties[0].id] : [],
  );
  const scoped = role in ROLE_INFO && isPropertyScoped(role as HostRole);
  const missingProperties = scoped && selected.length === 0;
  // A role the actor can't give (e.g. an owner, seen by a general manager)
  // still shows, so the current choice is visible, but can't be picked.
  const roleChoices = ROLE_ORDER.filter((r) => props.roles.includes(r) || r === role);

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (missingProperties) return;
            props.onSubmit({ email: email.trim(), role, propertyIds: scoped ? selected : [] });
          }}
        >
          <DialogHeader>
            <DialogTitle>{member ? `Change ${member.name}'s access` : "Invite someone"}</DialogTitle>
            <DialogDescription>
              {member
                ? "Changes apply straight away. Giving someone the owner or general manager role asks you to confirm it's you."
                : "They get an email with a link. The invitation is open for 7 days; they sign in with this address to accept."}
            </DialogDescription>
          </DialogHeader>

          {!member ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@yourhotel.com"
              />
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <legend className="text-sm font-medium">Role</legend>
              <button
                type="button"
                onClick={props.onCompareRoles}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Compare roles
              </button>
            </div>
            {roleChoices.map((choice) => {
              const info = ROLE_INFO[choice];
              const id = `role-${choice}`;
              const checked = role === choice;
              const disabled = !props.roles.includes(choice);
              const choiceScoped = isPropertyScoped(choice);
              return (
                <div
                  key={choice}
                  className={cn(
                    "rounded-md border px-3 py-2.5 transition-colors",
                    checked ? "border-(--accent-7) bg-(--accent-3)/40" : "hover:bg-accent",
                    disabled && "opacity-60",
                  )}
                >
                  <label htmlFor={id} className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-0.5">
                    <input
                      id={id}
                      type="radio"
                      name="role"
                      value={choice}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => setRole(choice)}
                      className="mt-1 size-3.5 accent-(--accent-9)"
                    />
                    <span className="text-sm font-medium">{info.label}</span>
                    <span className="text-xs text-muted-foreground">{choiceScoped ? "Chosen properties" : "All properties"}</span>
                    <span className="col-start-2 col-end-4 text-xs text-muted-foreground">{info.summary}</span>
                  </label>
                  {checked && choiceScoped ? (
                    <div role="group" aria-label="Properties" className="mt-3 ml-6.5 flex flex-col gap-2">
                      {properties.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Your organisation has no properties yet.</p>
                      ) : (
                        properties.map((property) => {
                          const pid = `property-${property.id}`;
                          return (
                            <div key={property.id} className="flex items-center gap-2">
                              <Checkbox
                                id={pid}
                                checked={selected.includes(property.id)}
                                onCheckedChange={(value) =>
                                  setSelected((current) =>
                                    value === true
                                      ? [...new Set([...current, property.id])]
                                      : current.filter((p) => p !== property.id),
                                  )
                                }
                              />
                              <Label htmlFor={pid} className="font-normal">
                                {property.name}
                              </Label>
                            </div>
                          );
                        })
                      )}
                      {missingProperties && properties.length > 0 ? (
                        <p className="text-xs text-muted-foreground">Choose at least one property.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </fieldset>

          <DialogFooter className="sm:justify-between">
            {props.onRemove ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive sm:mr-auto"
                onClick={props.onRemove}
                disabled={props.busy}
              >
                Remove from team
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" onClick={props.onClose} disabled={props.busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={props.busy || missingProperties || (!member && !email.trim())}>
                {member ? "Save" : "Send invitation"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
