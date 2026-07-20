import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Header bar */}
      <div className="flex h-(--header-height) items-center gap-2 border-b px-4 lg:px-6">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
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
    </div>
  );
}
