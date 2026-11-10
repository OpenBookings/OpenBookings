"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronLeft, Maximize2, X } from "lucide-react";
import { reviewBand, type ReviewBand } from "@openbookings/pricing";
import type { PropertyReviews, PublicReview } from "@openbookings/db/reviews";
import FocusOverlay from "@/components/plug-in/FocusOverlay";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  bandCounts,
  countryName,
  featuredReview,
  filterAndSort,
  postedLabel,
  REVIEW_SORTS,
  stayMonthLabel,
  type ReviewSort,
} from "../_lib/reviews-view";

const VERIFIED = "Only guests who booked through OpenBookings and stayed can review.";

const SELECT =
  "h-9 w-full appearance-none rounded-lg border border-white/15 bg-white/5 pr-8 pl-3 text-[13px] text-white outline-none focus-visible:ring-2 focus-visible:ring-white/40";

/** A review's own score: neutral, colour is for state only. */
function ScoreChip({ score, className }: { score: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] min-w-[30px] items-center justify-center rounded-lg border border-white/15 bg-white/8 px-2 text-[13px] font-semibold tabular-nums",
        className,
      )}
    >
      {score}
    </span>
  );
}

const byline = (r: PublicReview) => `${r.authorName}${r.authorCountry ? `, ${r.authorCountry}` : ""}`;

/**
 * The Overview's review card: the average and one recent review, and from it
 * every review in a card over the blurred page (list and filters on the left,
 * the chosen review on the right; one at a time on a phone).
 */
export function ReviewsCard({ data, propertyName }: { data: PropertyReviews; propertyName: string }) {
  const [open, setOpen] = useState(false);
  const featured = featuredReview(data.reviews);

  if (data.total === 0) {
    return (
      <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-4">
        <span className="font-serif text-2xl text-white">No reviews yet</span>
        <p className="text-sm leading-relaxed text-white/65">
          Guests can review this property 24 hours after their stay. The first reviews show here.
        </p>
        <p className="text-xs leading-relaxed text-white/50">{VERIFIED}</p>
      </div>
    );
  }

  const showLabel = data.total === 1 ? "Show the review" : data.total === 2 ? "Show both reviews" : `Show all ${data.total} reviews`;

  return (
    <>
      <div className="rounded-2xl border border-white/8 bg-white/2 p-7 flex flex-col gap-7">
        <div className="flex items-center justify-between gap-4">
          {data.average !== null ? (
            <div className="flex items-center gap-3">
              <span className="font-serif text-3xl text-white tabular-nums">{data.average.toFixed(1)}</span>
              <div className="flex flex-col items-start">
                <span className="text-sm text-white/75">{reviewBand(data.average).label}</span>
                <span className="text-xs text-white/50">
                  {data.total} verified {data.total === 1 ? "review" : "reviews"}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="font-serif text-2xl text-white">
                {data.total} {data.total === 1 ? "review" : "reviews"}
              </span>
              <span className="text-xs text-white/50">The average shows from 3 reviews.</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={showLabel}
            title={showLabel}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-black/30 text-white/80 backdrop-blur-2xl transition-colors hover:bg-white/10 hover:text-white"
          >
            <Maximize2 aria-hidden className="size-4" strokeWidth={1.8} />
          </button>
        </div>

        {featured ? (
          <>
            <div className="border-t border-white/6" />
            <div className="flex flex-col gap-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Recent review</p>
              {featured.body ? (
                <blockquote className="text-sm text-white/75 leading-relaxed italic line-clamp-5">
                  &ldquo;{featured.body}&rdquo;
                </blockquote>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-white/50">
                  {byline(featured)} · Stayed in {stayMonthLabel(featured.stayMonth)}
                </span>
                <ScoreChip score={featured.score} className="h-8 text-sm" />
              </div>
            </div>
          </>
        ) : null}

        <p className="text-xs leading-relaxed text-white/50">{VERIFIED}</p>
      </div>

      <FocusOverlay open={open} onClose={() => setOpen(false)} contentClassName="max-w-6xl px-3 sm:px-8">
        <ReviewsPanel data={data} propertyName={propertyName} onClose={() => setOpen(false)} />
      </FocusOverlay>
    </>
  );
}

function ReviewsPanel({ data, propertyName, onClose }: { data: PropertyReviews; propertyName: string; onClose: () => void }) {
  const titleId = useId();
  const [band, setBand] = useState<ReviewBand | "all">("all");
  const [sort, setSort] = useState<ReviewSort>("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Phones show the list or one review, never both.
  const [phoneDetail, setPhoneDetail] = useState(false);

  const list = useMemo(() => filterAndSort(data.reviews, band, sort), [data.reviews, band, sort]);
  const counts = useMemo(() => bandCounts(data.reviews), [data.reviews]);
  const selected = list.find((r) => r.id === selectedId) ?? list[0] ?? null;
  const position = selected ? list.indexOf(selected) + 1 : 0;

  return (
    <Card
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="h-[min(760px,88dvh)] gap-0 overflow-hidden border-white/10 py-0 text-white shadow-2xl"
    >
      <header className="flex items-start gap-4 border-b border-white/8 px-5 pt-5 pb-4 sm:px-7 sm:pt-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 id={titleId} className="text-xl font-semibold sm:text-[22px]">
            Guest reviews
          </h2>
          <p className="text-xs text-white/55">{VERIFIED}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close reviews"
          className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center text-white/60 hover:text-white"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[400px_minmax(0,1fr)]">
        {/* The list, with its filters */}
        <div className={cn("min-h-0 flex-col border-white/8 md:flex md:border-r", phoneDetail ? "hidden" : "flex")}>
          <div className="flex flex-col gap-3 border-b border-white/6 px-4 py-4 sm:px-5">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-white/50">
                Score
                <span className="relative">
                  <select value={band} onChange={(e) => setBand(e.target.value as ReviewBand | "all")} className={SELECT}>
                  <option value="all" className="bg-[#111]">
                    All scores ({data.reviews.length})
                  </option>
                  {counts.map((b) => (
                    <option key={b.id} value={b.id} disabled={b.count === 0} className="bg-[#111]">
                      {b.label} ({b.count})
                    </option>
                  ))}
                </select>
                  <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-white/50" />
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/50">
                Sort
                <span className="relative">
                  <select value={sort} onChange={(e) => setSort(e.target.value as ReviewSort)} className={SELECT}>
                  {REVIEW_SORTS.map((s) => (
                    <option key={s.id} value={s.id} className="bg-[#111]">
                      {s.label}
                    </option>
                  ))}
                </select>
                  <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-white/50" />
                </span>
              </label>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3">
            {list.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <p className="text-sm text-white/65">No reviews match this filter.</p>
                <button
                  type="button"
                  onClick={() => setBand("all")}
                  className="h-8 rounded-full border border-white/15 bg-white/4 px-3 text-[13px] text-white hover:bg-white/10"
                >
                  Show all reviews
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {list.map((r) => {
                  const on = selected?.id === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        aria-current={on || undefined}
                        onClick={() => {
                          setSelectedId(r.id);
                          setPhoneDetail(true);
                        }}
                        className={cn(
                          "flex w-full flex-col gap-1.5 rounded-xl border px-3 py-3 text-left transition-colors",
                          on ? "md:border-white/15 md:bg-white/7 border-transparent" : "border-transparent hover:bg-white/4",
                        )}
                      >
                        <span className="flex items-center gap-2.5">
                          <ScoreChip score={r.score} />
                          <span className="truncate text-sm font-medium">{byline(r)}</span>
                          <span className="ml-auto shrink-0 text-xs text-white/45">{stayMonthLabel(r.stayMonth, true)}</span>
                        </span>
                        <span className={cn("line-clamp-2 text-[13px] leading-normal", r.body ? "text-white/65" : "text-white/40 italic")}>
                          {r.body ?? "Score only, no written review"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {data.total > data.reviews.length ? (
              <p className="px-3 py-3 text-xs text-white/40">Showing the {data.reviews.length} most recent reviews.</p>
            ) : null}
          </div>
        </div>

        {/* The chosen review */}
        <article className={cn("min-h-0 flex-col overflow-y-auto md:flex", phoneDetail ? "flex" : "hidden")}>
          <div className="flex items-center justify-between border-b border-white/8 px-2 md:hidden">
            <button
              type="button"
              onClick={() => setPhoneDetail(false)}
              className="flex h-11 items-center gap-1.5 px-2 text-sm text-white"
            >
              <ChevronLeft className="size-4" />
              All reviews
            </button>
            {selected ? <span className="pr-3 text-xs text-white/45">{position} of {list.length}</span> : null}
          </div>

          {selected ? (
            <div className="flex flex-1 flex-col gap-6 px-5 py-6 sm:px-10 sm:py-8">
              <div className="flex items-end gap-3">
                <span className="font-serif text-6xl leading-[0.9] tabular-nums">{selected.score}</span>
                <span className="pb-1 text-xl text-white/45">/ 10</span>
                <span className="ml-1 pb-1.5 text-[15px] text-white/80">{reviewBand(selected.score).label}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[17px] font-semibold">{selected.authorName}</span>
                {selected.authorCountry ? (
                  <span className="text-[15px] text-white/60">{countryName(selected.authorCountry)}</span>
                ) : null}
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-white/75">
                  <Check aria-hidden className="size-3" strokeWidth={2.4} />
                  Verified stay
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-4 border-y border-white/8 py-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-white/50">Stayed</dt>
                  <dd className="mt-1 text-sm">{stayMonthLabel(selected.stayMonth)}</dd>
                </div>
                {selected.roomLabel ? (
                  <div>
                    <dt className="text-xs text-white/50">Room</dt>
                    <dd className="mt-1 text-sm">{selected.roomLabel}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-white/50">Posted</dt>
                  <dd className="mt-1 text-sm">{postedLabel(selected.publishedAt)}</dd>
                </div>
              </dl>

              {selected.body ? (
                <p className="text-base leading-relaxed whitespace-pre-line text-white/88">{selected.body}</p>
              ) : (
                <p className="text-[15px] text-white/55">{selected.authorName} gave a score without writing a review.</p>
              )}

              {selected.replies.length > 0 ? <ReplyThread review={selected} propertyName={propertyName} /> : null}

              <div className="mt-auto flex items-center justify-between pt-2">
                <span className="hidden text-xs text-white/40 md:inline">
                  {position} of {list.length}
                </span>
                <a
                  href={`mailto:support@openbookings.co?subject=${encodeURIComponent(`Report review ${selected.id}`)}`}
                  className="text-xs text-white/50 underline-offset-4 hover:text-white/80 hover:underline"
                >
                  Report this review
                </a>
              </div>
            </div>
          ) : null}
        </article>
      </div>
    </Card>
  );
}

/** Replies under a review: the property's, and the guest's answer, oldest first. */
function ReplyThread({ review, propertyName }: { review: PublicReview; propertyName: string }) {
  return (
    <div className="flex flex-col gap-4">
      {review.replies.map((r) => (
        <div key={r.id} className={cn("flex flex-col gap-1.5 border-l border-white/15 pl-4", r.role === "guest" && "ml-4")}>
          <p className="text-xs text-white/50">
            <span className="font-medium text-white/80">
              {r.role === "host" ? `Response from ${propertyName}` : `${review.authorName} answered`}
            </span>
            {r.publishedAt ? ` · ${postedLabel(r.publishedAt)}` : ""}
            {r.editedAt ? " · Edited" : ""}
          </p>
          <p className="text-[15px] leading-relaxed whitespace-pre-line text-white/75">{r.body}</p>
        </div>
      ))}
    </div>
  );
}
