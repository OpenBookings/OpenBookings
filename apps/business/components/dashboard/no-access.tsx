import { LockIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export type NoAccessProps = {
  hotelName: string;
  /** The viewer's role at the hotel, as people see it ("Front desk"). */
  roleLabel: string;
  /** The page, in the words of the menu ("Payouts"). */
  pageName: string;
  /** Labels of the roles that can open the page. */
  neededRoles: string[];
  /** Names of the org's owners and general managers; empty leaves out whom to ask. */
  admins: string[];
};

/** "A", "A and B", "A, B and C" (or "or" in place of "and"). */
export function listSentence(items: readonly string[], last = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}

export function noAccessCopy({ hotelName, roleLabel, pageName, neededRoles, admins }: NoAccessProps) {
  const sentences = [`Your role at ${hotelName} (${roleLabel}) can't open ${pageName}.`];
  if (neededRoles.length > 0) sentences.push(`${listSentence(neededRoles)} can.`);
  if (admins.length > 0) sentences.push(`Ask ${listSentence(admins, "or")} for access.`);
  return { title: `No access at ${hotelName}`, body: sentences.join(" ") };
}

/**
 * What a console page shows in place of its content when the viewer's role
 * at the current hotel can't open it. The page loads none of its own data.
 */
export function NoAccess(props: NoAccessProps) {
  const { title, body } = noAccessCopy(props);
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LockIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
