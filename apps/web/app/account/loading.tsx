import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown the moment an account tab is clicked, while the server loads the page.
 * The nav and backdrop belong to the layout and stay put. Without it the old
 * page stayed on screen with no sign the click had landed.
 */
export default function AccountLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
