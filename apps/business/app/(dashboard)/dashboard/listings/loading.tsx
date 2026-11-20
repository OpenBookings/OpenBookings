import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";

/** The layout already shows the header. */
export default function Loading() {
  return <DashboardSkeleton withHeader={false} />;
}
