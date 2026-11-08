import Link from "next/link";
import { getPool } from "@openbookings/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { searchBookings } from "@/lib/search";
import { requireSuperAdmin } from "@/lib/super-admin";

const STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show", "checked_in"];

type Params = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  requireSuperAdmin();
  const sp = await searchParams;
  const input = {
    q: first(sp.q),
    status: first(sp.status) || undefined,
    property: first(sp.property) || undefined,
    from: first(sp.from) || undefined,
    to: first(sp.to) || undefined,
  };
  const db = getPool();
  const [rows, props] = await Promise.all([
    searchBookings(db, input),
    db.query("SELECT id, name FROM properties ORDER BY name"),
  ]);
  const properties = props.rows as { id: string; name: string }[];
  const eur = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <Input
          name="q"
          defaultValue={input.q}
          placeholder="Booking id, reservation id, pi_..., email or name"
          className="w-96"
        />
        <select name="status" defaultValue={input.status ?? ""} className={selectClass} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="property" defaultValue={input.property ?? ""} className={selectClass} aria-label="Property">
          <option value="">Any property</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Input type="date" name="from" defaultValue={input.from} className="w-40" aria-label="Check-in from" />
        <Input type="date" name="to" defaultValue={input.to} className="w-40" aria-label="Check-in to" />
        <Button type="submit">Search</Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">No bookings match.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Booking</TableHead>
              <TableHead>Guest</TableHead>
              <TableHead>Property</TableHead>
              <TableHead>Stay</TableHead>
              <TableHead>Rooms</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/bookings/${r.id}`} className="font-mono underline">
                    {r.id.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell>
                  <div>{r.guestName ?? "-"}</div>
                  <div className="text-xs text-muted-foreground">{r.guestEmail}</div>
                </TableCell>
                <TableCell>{r.propertyName}</TableCell>
                <TableCell>
                  {r.checkIn} → {r.checkOut}
                </TableCell>
                <TableCell>{r.rooms}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.status}</Badge>
                </TableCell>
                <TableCell className="text-right">{eur.format(r.totalAmount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
