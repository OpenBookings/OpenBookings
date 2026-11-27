import Link from "next/link";
import { MODERATION_DEADLINE_HOURS } from "@openbookings/pricing";
import { readPool } from "@/lib/db";
import { isModerationTab, loadModerationCounts, loadModerationQueue, MODERATION_TABS, type ModerationTab } from "@/lib/moderation";
import { itemView, TAB_LABELS } from "@/lib/moderation-view";
import { requireStaff } from "@/lib/staff";
import { cn } from "@/lib/utils";
import { ReviewItem } from "./review-item";

type Params = Record<string, string | string[] | undefined>;

const EMPTY: Record<ModerationTab, string> = {
  held: "Nothing is held. Every new review and reply passed the check.",
  reported: "No open reports.",
  deadline: "Nothing was published by the deadline without a decision.",
  decided: "Nothing decided yet.",
};

/**
 * Review moderation: what the check held, what people reported, what the
 * deadline published masked, and what was decided. Judge the words, never
 * the score.
 */
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaff();
  const sp = await searchParams;
  const requested = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: ModerationTab = isModerationTab(requested) ? requested : "held";
  const db = readPool();
  const now = new Date();
  const [rows, counts] = await Promise.all([loadModerationQueue(db, tab, now), loadModerationCounts(db)]);
  const views = rows.map((row) => itemView(row, now));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Judge what it says, never the score. Anything not decided in {MODERATION_DEADLINE_HOURS} hours publishes with the
          flagged parts masked.
        </p>
      </div>

      <nav aria-label="Queue" className="flex flex-wrap gap-1 border-b">
        {MODERATION_TABS.map((t) => (
          <Link
            key={t}
            href={t === "held" ? "/reviews" : `/reviews?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              t === tab ? "border-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABELS[t]}
            {t !== "decided" ? <span className="ml-1.5 font-medium text-muted-foreground">{counts[t]}</span> : null}
          </Link>
        ))}
      </nav>

      {views.length === 0 ? (
        <p className="text-muted-foreground">{EMPTY[tab]}</p>
      ) : (
        views.map((view) => <ReviewItem key={`${view.key}:${view.version}`} view={view} />)
      )}
    </div>
  );
}
