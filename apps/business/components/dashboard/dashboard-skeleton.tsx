import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The loading state for Overview, Bookings, Listings and Team. Each section
 * has its own loading.tsx with it, never one for the whole dashboard: that
 * one would also cover Analytics and Finance, and flash before their logo
 * loader on a full page load. `withHeader` is off where the section's layout
 * already shows the real header.
 */
export function DashboardSkeleton({ withHeader = true }: { withHeader?: boolean }) {
  const content = (
    // Under a section layout, the layout already pads the content.
    <div className={cn("flex flex-col gap-4 md:gap-6", withHeader && "py-4 md:py-6")}>
      {/* Section cards */}
      <div className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      {/* Main content block */}
      <div className="px-4 lg:px-6">
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
  if (!withHeader) return content;

  return (
    <div className="flex flex-1 flex-col">
      {/* Header bar */}
      <div className="flex h-(--header-height) items-center gap-2 border-b px-4 lg:px-6">
        <Skeleton className="h-5 w-32" />
      </div>
      {content}
    </div>
  );
}
