import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAdminAudit } from "@/lib/audit";
import { readPool } from "@/lib/db";
import { requireStaff } from "@/lib/staff";

const when = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Europe/Amsterdam", dateStyle: "medium", timeStyle: "medium" });

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** What staff did with dangerous actions, newest first. Outcome rows (.failed, .refused) sit inline. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff();
  const target = first((await searchParams).target).trim();
  const rows = await listAdminAudit(readPool(), target || undefined);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Audit</h1>
        <p className="text-sm text-muted-foreground">The latest 200 admin actions.</p>
      </div>

      <form className="flex gap-2">
        <input
          name="target"
          defaultValue={target}
          placeholder="Target id (e.g. a booking id)"
          className="h-9 w-96 rounded-md border border-input bg-transparent px-3 text-sm"
        />
        <button type="submit" className="h-9 rounded-md border px-3 text-sm">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">Nothing recorded.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Step-up</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{when(r.at)}</TableCell>
                <TableCell className="font-mono text-xs">{r.action}</TableCell>
                <TableCell>{r.actorEmail ?? ""}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.targetType ? `${r.targetType} ` : ""}
                  {r.targetId ?? ""}
                </TableCell>
                <TableCell className="max-w-xs whitespace-normal">{r.reason ?? ""}</TableCell>
                <TableCell>{r.stepUp ?? ""}</TableCell>
                <TableCell className="max-w-xs whitespace-normal">{r.outcome ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
