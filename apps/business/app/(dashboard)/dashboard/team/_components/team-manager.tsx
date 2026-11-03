"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2, UserPlus, X } from "lucide-react";
import { isPropertyScoped, type HostRole } from "@openbookings/authz/permissions";
import { ROLE_INFO, assignableRoles, roleLabel } from "@openbookings/authz/role-guide";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
}: {
  team: Team;
  actorRole: string;
  actorUserId: string;
  factors: { hasPasskey: boolean; hasAuthenticator: boolean };
}) {
  const router = useRouter();
  const { guard, dialog: stepUpDialog } = useStepUp(factors);
  const [editing, setEditing] = React.useState<Editing>(null);
  const [busy, setBusy] = React.useState(false);
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

  function scopeLabel(role: string, propertyIds: string[]): string {
    if (!(role in ROLE_INFO) || !isPropertyScoped(role as HostRole)) return "All properties";
    if (propertyIds.length === 0) return "No properties yet";
    return propertyIds.map((id) => propertyName.get(id) ?? "Removed property").join(", ");
  }

  const canTouch = (member: TeamMember) =>
    member.userId !== actorUserId && (actorIsOwner || !member.role.split(",").includes("owner"));
  const justYou = team.members.length === 1 && team.invitations.length === 0;

  return (
    <section aria-labelledby="people-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="people-heading" className="text-lg font-medium">
            People
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Everyone who can sign in to this organisation, and what they can reach.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({ kind: "invite" })} disabled={busy}>
          <UserPlus /> Invite someone
        </Button>
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
                <TableCell>{roleLabel(member.role)}</TableCell>
                <TableCell className="max-w-[16rem] whitespace-normal text-sm text-muted-foreground">
                  {scopeLabel(member.role, member.propertyIds)}
                </TableCell>
                <TableCell>
                  {canTouch(member) ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Change ${member.name}'s access`}
                        disabled={busy}
                        onClick={() => setEditing({ kind: "edit", member })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Remove ${member.name}`}
                        disabled={busy}
                        onClick={() => setEditing({ kind: "remove", member })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
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
                <span className="text-muted-foreground">{scopeLabel(invitation.role, invitation.propertyIds)}</span>
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
                    <X /> Withdraw
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <AccessDialog
        key={editing?.kind === "edit" ? editing.member.memberId : editing?.kind ?? "closed"}
        open={editing?.kind === "invite" || editing?.kind === "edit"}
        member={editing?.kind === "edit" ? editing.member : null}
        roles={roles}
        properties={team.properties}
        busy={busy}
        onClose={() => !busy && setEditing(null)}
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
    </section>
  );
}

function AccessDialog(props: {
  open: boolean;
  member: TeamMember | null;
  roles: HostRole[];
  properties: Team["properties"];
  busy: boolean;
  onClose: () => void;
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
  const roleChoices = props.roles.includes(role as HostRole) ? props.roles : [...props.roles, role as HostRole];

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-lg">
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="access-role">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="access-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleChoices.map((choice) => (
                  <SelectItem key={choice} value={choice} disabled={!props.roles.includes(choice)}>
                    {ROLE_INFO[choice]?.label ?? choice}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {role in ROLE_INFO ? (
              <p className="text-sm text-muted-foreground">{ROLE_INFO[role as HostRole].summary}</p>
            ) : null}
          </div>

          {scoped ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Properties</legend>
              {properties.length === 0 ? (
                <p className="text-sm text-muted-foreground">Your organisation has no properties yet.</p>
              ) : (
                properties.map((property) => {
                  const id = `property-${property.id}`;
                  const checked = selected.includes(property.id);
                  return (
                    <div key={property.id} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(value) =>
                          setSelected((current) =>
                            value === true
                              ? [...new Set([...current, property.id])]
                              : current.filter((p) => p !== property.id),
                          )
                        }
                      />
                      <Label htmlFor={id} className="font-normal">
                        {property.name}
                      </Label>
                    </div>
                  );
                })
              )}
              {missingProperties ? (
                <p className="text-sm text-muted-foreground">Choose at least one property.</p>
              ) : null}
            </fieldset>
          ) : (
            <p className="text-sm text-muted-foreground">This role covers all of your properties.</p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose} disabled={props.busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={props.busy || missingProperties || (!member && !email.trim())}>
              {member ? "Save" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
