import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { ReservationStatus as MockReservationStatus } from "@/components/dashboard/reservation-types";

// One mapping for the whole console (globals.css → "State"): positive =
// booked, onsite = on the property, attention = needs a decision, stopped =
// cancelled or no-show, neutral = done.
const statusConfig: Record<MockReservationStatus, { label: string; tone: StatusTone }> = {
  confirmed: { label: "Confirmed", tone: "positive" },
  checked_in: { label: "Checked in", tone: "onsite" },
  pending: { label: "Pending", tone: "attention" },
  checked_out: { label: "Checked out", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "stopped" },
  no_show: { label: "No-show", tone: "stopped" },
};

export function ReservationStatusBadge({ status }: { status: MockReservationStatus }) {
  const { label, tone } = statusConfig[status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
