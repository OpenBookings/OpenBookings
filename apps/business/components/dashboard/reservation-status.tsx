import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MockReservationStatus } from "@/components/dashboard/mock-reservations";

// Status hues follow the guest lifecycle: indigo (brand) = booked, green =
// on the property, amber = needs a decision, neutral = done.
const statusConfig: Record<
  MockReservationStatus,
  { label: string; className: string }
> = {
  confirmed: {
    label: "Confirmed",
    className: "bg-(--accent-3) text-(--accent-11)",
  },
  checked_in: {
    label: "Checked in",
    className: "bg-(--green-3) text-(--green-11)",
  },
  pending: {
    label: "Pending",
    className: "bg-(--amber-3) text-(--amber-11)",
  },
  checked_out: {
    label: "Checked out",
    className: "bg-muted text-muted-foreground",
  },
};

export function ReservationStatusBadge({
  status,
}: {
  status: MockReservationStatus;
}) {
  const { label, className } = statusConfig[status];
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent px-1.5", className)}
    >
      {label}
    </Badge>
  );
}
