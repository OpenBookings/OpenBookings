import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dimensions match the real widgets, so nothing jumps when the data arrives.
 * A skeleton that resizes on load is a worse experience than a spinner.
 */
function KpiSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-16" />
      </CardContent>
    </Card>
  );
}

function ChartSkeleton({ height = "h-64" }: { height?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className={`w-full ${height}`} />
      </CardContent>
    </Card>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-8 px-4 lg:px-6" aria-busy="true" aria-label="Loading analytics">
      {[4, 2, 3, 2, 3].map((kpis, section) => (
        <section key={section} className="space-y-4">
          <Skeleton className="h-5 w-32" />
          <div className="grid gap-4 @lg/main:grid-cols-2 @4xl/main:grid-cols-4">
            {Array.from({ length: kpis }, (_, i) => (
              <KpiSkeleton key={i} />
            ))}
          </div>
          <div className="grid gap-4 @4xl/main:grid-cols-2">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
        </section>
      ))}
    </div>
  );
}
