"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Star } from "lucide-react";
import { REVIEW_BANDS, type ReviewBand } from "@openbookings/pricing";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { filterHostReviews, inTab, summarize, type HostReview, type HostReviewSort, type ReviewTab } from "@/lib/reviews/shape";
import { ReviewDetail } from "./review-detail";
import { ReviewsList } from "./reviews-list";
import { ReviewsSummary } from "./reviews-summary";
import { byline } from "./labels";

const DESKTOP_QUERY = "(min-width: 1024px)";

function useIsDesktop() {
  return React.useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia(DESKTOP_QUERY);
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

const TABS: { value: ReviewTab; label: string; short: string; empty: string }[] = [
  { value: "reply", label: "To reply", short: "To reply", empty: "Nothing waiting for a reply." },
  { value: "all", label: "All", short: "All", empty: "No reviews match these filters." },
  { value: "checking", label: "Being checked", short: "Checking", empty: "No reviews are being checked." },
];

const SORTS: { value: HostReviewSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "highest", label: "Highest score" },
  { value: "lowest", label: "Lowest score" },
];

/**
 * Bookings › Reviews. Same shape as Messages: the list on the left, the
 * open review on the right, a sheet on phones. Selection lives in the URL
 * (?id=<reviewId>) so a review can be linked to.
 */
export function ReviewsView({ reviews }: { reviews: HostReview[] }) {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = React.useState<ReviewTab>("reply");
  const [propertyId, setPropertyId] = React.useState<string>("all");
  const [band, setBand] = React.useState<ReviewBand | "all">("all");
  const [sort, setSort] = React.useState<HostReviewSort>("newest");

  const properties = React.useMemo(
    () => [...new Map(reviews.map((r) => [r.propertyId, r.propertyName])).entries()],
    [reviews],
  );
  const summary = React.useMemo(() => summarize(reviews, propertyId, new Date()), [reviews, propertyId]);
  const list = React.useMemo(
    () => filterHostReviews(reviews, { tab, propertyId, band, sort }),
    [reviews, tab, propertyId, band, sort],
  );
  const counts = React.useMemo(
    () =>
      Object.fromEntries(
        TABS.map((t) => [t.value, reviews.filter((r) => inTab(r, t.value) && (propertyId === "all" || r.propertyId === propertyId)).length]),
      ) as Record<ReviewTab, number>,
    [reviews, propertyId],
  );

  const selectedId = searchParams.get("id");
  // The URL can point at a review in another tab (a link from elsewhere): it stays open.
  const selected = reviews.find((r) => r.id === selectedId) ?? (isDesktop ? (list[0] ?? null) : null);

  const select = (id: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (id === null) params.delete("id");
    else params.set("id", id);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  if (reviews.length === 0) {
    return (
      <Empty className="mx-4 flex-1 border lg:mx-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Star />
          </EmptyMedia>
          <EmptyTitle>No reviews yet</EmptyTitle>
          <EmptyDescription>
            We email your guests a day after they check out. Their reviews show up here, and you can reply to each one.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <ReviewsSummary summary={summary} />

      <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 lg:px-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ReviewTab)} className="w-full sm:w-auto">
          <TabsList className="w-full sm:w-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="flex-1 sm:flex-none">
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
                <Badge variant="secondary" className="ml-1.5 px-1.5">
                  {counts[t.value]}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap gap-2">
          {properties.length > 1 ? (
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger size="sm" aria-label="Property">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All properties</SelectItem>
                {properties.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select value={band} onValueChange={(v) => setBand(v as ReviewBand | "all")}>
            <SelectTrigger size="sm" aria-label="Score">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scores</SelectItem>
              {REVIEW_BANDS.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as HostReviewSort)}>
            <SelectTrigger size="sm" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-start px-4 lg:items-stretch lg:px-6">
        <div className="max-h-full min-w-0 flex-1 overflow-y-auto rounded-lg border lg:max-w-sm lg:self-start">
          <ReviewsList
            reviews={list}
            selectedId={selected?.id ?? null}
            onSelect={(r) => select(r.id)}
            emptyMessage={TABS.find((t) => t.value === tab)!.empty}
          />
        </div>
        <div className="hidden min-w-0 flex-1 lg:ml-4 lg:flex lg:min-h-0 lg:flex-col">
          {/* Phones open the review in the sheet below; mounting it here too would double its state. */}
          {selected && isDesktop ? (
            <ReviewDetail key={selected.id} review={selected} />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-lg border p-6 text-sm text-muted-foreground">
              Select a review to read it.
            </div>
          )}
        </div>
      </div>

      {!isDesktop && (
        <Sheet open={selectedId !== null && selected !== null} onOpenChange={(open) => !open && select(null)}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md [&>button]:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>{selected ? `Review by ${byline(selected)}` : "Review"}</SheetTitle>
            </SheetHeader>
            {selected ? <ReviewDetail key={selected.id} review={selected} onClose={() => select(null)} /> : null}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
