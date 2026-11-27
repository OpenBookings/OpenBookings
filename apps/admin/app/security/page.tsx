import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readPool } from "@/lib/db";
import { requireStaff } from "@/lib/staff";
import { listCredentials } from "@/lib/step-up/credentials";
import { EnrolPanel } from "./enrol-panel";

const when = (d: Date | null) =>
  d ? d.toLocaleString("en-GB", { timeZone: "Europe/Amsterdam", dateStyle: "medium", timeStyle: "short" }) : "Never";

const KIND_LABEL = { passkey: "Passkey", totp: "Authenticator app" } as const;

/** Your passkeys and authenticator apps, and adding one. */
export default async function SecurityPage() {
  const staff = await requireStaff();
  const credentials = await listCredentials(readPool(), staff.userId);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Security</h1>
        <p className="text-sm text-muted-foreground">Dangerous actions ask for one of these.</p>
      </div>

      {credentials.length === 0 ? (
        <p className="text-muted-foreground">You have none yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Added</TableHead>
              <TableHead>Last used</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {credentials.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.label ?? KIND_LABEL[c.kind]}</TableCell>
                <TableCell>{when(c.createdAt)}</TableCell>
                <TableCell>{when(c.lastUsedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <EnrolPanel firstCredential={credentials.length === 0} />
    </div>
  );
}
