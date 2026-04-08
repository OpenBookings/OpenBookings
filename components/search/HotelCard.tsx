"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** Wave bottom edge as % of image box height (scales with any aspect-ratio / clamp height). */
const WAVE_DEPTH_PCT = 4.4;

function clipPointsWave(waveDepthPct: number) {
  const pts = ["0% 0%", "100% 0%"];
  const steps = 60;
  for (let i = steps; i >= 0; i--) {
    const x = (i / steps) * 100;
    const t = i / steps;
    const waveOffsetPct = Math.sin(t * Math.PI) * waveDepthPct;
    const yPct = 100 - waveOffsetPct;
    pts.push(`${x}% ${yPct}%`);
  }
  return pts.join(", ");
}

const cardClip = `polygon(${clipPointsWave(WAVE_DEPTH_PCT)})`;

/** Card + image block behind the wave clip (same fill in both places). */
const CARD_BODY_BG = "rgba(18,17,26,0.82)";

/** Hero image aspect — keeps image height locked to the same width as the card. */
const IMAGE_ASPECT = "280 / 210" as const;

export type HotelCardData = {
  id: number;
  name: string;
  distance: string;
  rating: number;
  reviews: number;
  price: number;
  tags: string[];
  /** When multiple URLs are provided, prev/next controls appear on image hover. */
  images?: string[];
};

function HotelCardHeroImage({
  gallery,
  hotelName,
  showTopRatedBadge,
}: {
  gallery: string[];
  hotelName: string;
  showTopRatedBadge: boolean;
}) {
  const [imageIndex, setImageIndex] = useState(0);
  const hasGallery = gallery.length > 1;
  const currentSrc = gallery[imageIndex] ?? gallery[0];

  return (
    <div
      className="group/image relative w-full shrink-0"
      style={
        {
          aspectRatio: IMAGE_ASPECT,
          backgroundColor: CARD_BODY_BG,
        } satisfies CSSProperties
      }
    >
      <div
        className="absolute inset-0"
        style={
          {
            clipPath: cardClip,
            WebkitClipPath: cardClip,
          } satisfies CSSProperties
        }
      >
        <img
          src={currentSrc}
          alt={hotelName}
          className="block size-full object-cover object-[center_15%] transition-transform duration-600 ease-out group-hover:scale-105"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[60px] bg-linear-to-b from-black/25 to-transparent" />
      </div>

      {hasGallery ? (
        <span className="pointer-events-none absolute right-3 bottom-3 z-10 inline-flex h-6 items-center rounded-full border border-white/22 bg-white/14 px-2.5 font-sans text-[10px] font-medium tracking-[0.08em] text-white backdrop-blur-sm">
          {imageIndex + 1} / {gallery.length}
        </span>
      ) : null}

      {hasGallery ? (
        <>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Previous photo"
            className={cn(
              "absolute top-1/2 left-2 z-10 h-8 w-8 -translate-y-1/2 rounded-full border border-white/22 bg-white/14 text-white shadow-none backdrop-blur-sm",
              "pointer-events-none opacity-0 transition-[opacity,background-color,border-color] duration-200 hover:bg-white/22 hover:text-white",
              "group-hover/image:pointer-events-auto group-hover/image:opacity-100",
              "focus-visible:pointer-events-auto focus-visible:opacity-100",
            )}
            onClick={(e) => {
              e.stopPropagation();
              setImageIndex((i) => (i - 1 + gallery.length) % gallery.length);
            }}
          >
            <ChevronLeft className="size-4 opacity-90" strokeWidth={2} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Next photo"
            className={cn(
              "absolute top-1/2 right-2 z-10 h-8 w-8 -translate-y-1/2 rounded-full border border-white/22 bg-white/14 text-white shadow-none backdrop-blur-sm",
              "pointer-events-none opacity-0 transition-[opacity,background-color,border-color] duration-200 hover:bg-white/22 hover:text-white",
              "group-hover/image:pointer-events-auto group-hover/image:opacity-100",
              "focus-visible:pointer-events-auto focus-visible:opacity-100",
            )}
            onClick={(e) => {
              e.stopPropagation();
              setImageIndex((i) => (i + 1) % gallery.length);
            }}
          >
            <ChevronRight className="size-4 opacity-90" strokeWidth={2} aria-hidden />
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function HotelCard({ hotel }: { hotel: HotelCardData }) {
  const gallery =
    hotel.images && hotel.images.length > 0 ? hotel.images : [];
  const showTopRatedBadge = hotel.rating >= 4.8 && hotel.reviews >= 200;

  return (
    <Card
      className={cn(
        "group relative h-full w-full min-w-0 cursor-pointer gap-0 overflow-hidden rounded-3xl border border-white/8 bg-transparent py-0 @container shadow-[0_8px_32px_rgba(0,0,0,0.35),0_2px_8px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.04)] transition-[transform,box-shadow] duration-600 ease-out hover:shadow-[0_32px_64px_rgba(0,0,0,0.5),0_8px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)]",
      )}
      style={
        {
          backgroundColor: CARD_BODY_BG,
        } satisfies CSSProperties
      }
    >
      <HotelCardHeroImage
        key={hotel.id}
        gallery={gallery}
        hotelName={hotel.name}
        showTopRatedBadge={showTopRatedBadge}
      />

      <CardContent
        className="-mt-px px-[clamp(14px,5cqw,22px)] pt-[clamp(10px,3.8cqw,14px)] pb-[clamp(14px,5.4cqw,22px)] backdrop-blur-xl"
        style={{ backgroundColor: CARD_BODY_BG }}
      >
        <h3 className="mb-[clamp(4px,1.6cqw,6px)] font-serif text-[clamp(1.1rem,7cqw,1.35rem)] leading-snug font-normal tracking-tight text-white/95">
          {hotel.name}
        </h3>

        <p className="mb-[clamp(10px,3.8cqw,14px)] flex items-center gap-1.5 font-sans text-[clamp(12px,3.2cqw,13px)] tracking-wide text-white/38">
          <svg
            width="14"
            height="14"
            viewBox="0 0 10 10"
            fill="none"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="1.6"
            aria-hidden
          >
            <path d="M5 1a3 3 0 0 1 3 3c0 2-3 5-3 5S2 6 2 4a3 3 0 0 1 3-3z" />
            <circle cx="5" cy="4" r="0.9" fill="rgba(255,255,255,0.3)" stroke="none" />
          </svg>
          {hotel.distance}
        </p>

        <div className="mb-[clamp(10px,3.8cqw,14px)] flex flex-wrap gap-[clamp(4px,1.4cqw,6px)]">
          {hotel.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex min-h-8 items-center rounded-full border border-[#C9A84C]/50 bg-[rgba(201,168,76,0.15)] px-[clamp(10px,3.2cqw,12px)] py-[clamp(2px,0.8cqw,3px)] font-sans text-[clamp(9px,2.5cqw,10px)] font-semibold tracking-widest text-[#E6C97B] uppercase"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mb-[clamp(12px,4.3cqw,18px)] flex items-center gap-2">
          <div className="flex gap-0.5" aria-hidden>
            {[1, 2, 3, 4, 5].map((s) => (
              <svg key={s} width="10" height="10" viewBox="0 0 12 12" aria-hidden>
                <path
                  d="M6 1l1.4 2.8L10.5 4.3l-2.25 2.2.53 3.1L6 8.15 3.22 9.6l.53-3.1L1.5 4.3l3.1-.5z"
                  fill={s <= Math.round(hotel.rating) ? "#C4973A" : "rgba(255,255,255,0.12)"}
                />
              </svg>
            ))}
          </div>
          <p className="font-sans text-[clamp(10.5px,3cqw,11.5px)] text-white/42">
            <span>{hotel.rating}</span>
            <span className="mx-2 text-white/65">|</span>
            <button
              type="button"
              className="cursor-pointer text-white/46 underline-offset-2 transition-colors"
            >
              {hotel.reviews} reviews
            </button>
          </p>
        </div>

        <Separator className="mb-[clamp(12px,4.3cqw,18px)] h-px bg-linear-to-r from-white/10 to-transparent" />

        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="mb-1 block font-sans text-[clamp(10px,2.8cqw,11px)] tracking-widest text-white/26 uppercase">
              from
            </span>
            <div className="flex items-baseline gap-1">
              <span className="font-serif text-[clamp(24px,9cqw,32px)] leading-none tracking-tight text-white/95">
                €{hotel.price}
              </span>
              <span className="font-sans text-[clamp(12px,3.7cqw,14px)] font-normal text-white/26">/night</span>
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            className="h-auto rounded-xl border border-[#E0BE69]/70 bg-[#C9A84C] px-[clamp(12px,4cqw,17px)] py-[clamp(8px,2.9cqw,11px)] font-sans text-[clamp(9.5px,2.55cqw,10.5px)] font-semibold tracking-[0.07em] text-[#1A1408] uppercase transition-[transform,background-color,border-color] duration-200 hover:scale-[1.04] hover:border-[#E9C773] hover:bg-[#D6B35A]"
          >
            <span className="inline-flex items-center gap-1.5">
              Explore
              <ArrowRight className="size-4" strokeWidth={2.1} aria-hidden />
            </span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
