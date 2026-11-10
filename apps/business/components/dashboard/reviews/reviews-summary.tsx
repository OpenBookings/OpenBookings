import { Card } from "@/components/ui/card";
import type { ReviewSummary } from "@/lib/reviews/shape";

/** One quiet card: the average guests see, the score words, and what needs doing. */
export function ReviewsSummary({ summary }: { summary: ReviewSummary }) {
  const top = Math.max(1, ...summary.bands.map((b) => b.count));
  const waiting =
    summary.waiting === 0 ? (
      "You're all caught up."
    ) : (
      <>
        <strong className="font-semibold text-foreground">
          {summary.waiting === 1 ? "1 review" : `${summary.waiting} reviews`}
        </strong>{" "}
        {summary.waiting === 1 ? "is" : "are"} waiting for a reply.
      </>
    );

  return (
    <Card className="mx-4 flex-row flex-wrap items-center gap-x-7 gap-y-3 bg-linear-to-t from-primary/5 to-card px-5 py-4 shadow-xs lg:mx-6 dark:bg-card">
      {summary.average !== null ? (
        <div className="flex items-center gap-3">
          <span className="text-3xl leading-none font-semibold tabular-nums">{summary.average.toFixed(1)}</span>
          <div className="flex flex-col">
            <span className="text-sm">{summary.band}</span>
            <span className="text-xs text-muted-foreground">
              {summary.recentCount} reviews · last 24 months
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {summary.recentCount === 1 ? "1 review" : `${summary.recentCount} reviews`}
          </span>
          <span className="text-xs text-muted-foreground">Your average shows from 3 reviews.</span>
        </div>
      )}

      <div
        className="hidden max-w-sm flex-1 basis-60 grid-cols-[4rem_1fr_1.5rem] items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground sm:grid"
        aria-label="Reviews per score word"
      >
        {summary.bands.map((b) => (
          <div key={b.id} className="contents">
            <span>{b.label}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-muted-foreground" style={{ width: `${(b.count / top) * 100}%` }} />
            </div>
            <span className="text-right tabular-nums">{b.count}</span>
          </div>
        ))}
      </div>

      <p className="basis-full text-sm text-muted-foreground sm:ml-auto sm:basis-auto">{waiting}</p>
    </Card>
  );
}
