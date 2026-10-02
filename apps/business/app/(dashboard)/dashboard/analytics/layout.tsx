import { SiteHeader } from "@/components/dashboard/site-header";

/**
 * `min-w-0` on every flex child between the viewport and the page. A flex item
 * refuses to shrink below its content without it, which is how a wide card
 * used to push the page past the right edge.
 */
export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader title="Analytics" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
