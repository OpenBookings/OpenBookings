"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

/** Single responsive width for card shell and image (content box drives 280:210 frame). */
const HOTEL_CARD_WIDTH = "clamp(260px, min(32vw, 42vh), 380px)";

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
}: {
  gallery: string[];
  hotelName: string;
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

  return (
    <Card
      className={cn(
        "group relative w-(--hotel-card-w) cursor-pointer gap-0 overflow-hidden rounded-3xl border border-white/8 bg-transparent py-0 shadow-[0_8px_32px_rgba(0,0,0,0.35),0_2px_8px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.04)] transition-[transform,box-shadow] duration-600 ease-out hover:shadow-[0_32px_64px_rgba(0,0,0,0.5),0_8px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)]",
      )}
      style={
        {
          backgroundColor: CARD_BODY_BG,
          ["--hotel-card-w" as string]: HOTEL_CARD_WIDTH,
        } satisfies CSSProperties
      }
    >
      <HotelCardHeroImage key={hotel.id} gallery={gallery} hotelName={hotel.name} />

      <CardContent
        className="-mt-px px-[22px] pt-3.5 pb-5.5 backdrop-blur-xl"
        style={{ backgroundColor: CARD_BODY_BG }}
      >
        <h3 className="mb-1.5 font-serif text-xl leading-snug font-normal tracking-tight text-white/95">
          {hotel.name}
        </h3>

        <p className="mb-3.5 flex items-center gap-1 font-sans text-[11px] tracking-wide text-white/38">
          <svg
            width="9"
            height="9"
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

        <div className="mb-3.5 flex flex-wrap gap-1.5">
          {hotel.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/12 bg-white/[0.07] px-2.5 py-1 font-sans text-[9px] font-semibold tracking-widest text-white/60 uppercase"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mb-4.5 flex items-center gap-1.5">
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
          <span className="font-sans text-[11px] text-white/35">
            {hotel.rating} · {hotel.reviews} reviews
          </span>
        </div>

        <Separator className="mb-4.5 h-px bg-linear-to-r from-white/10 to-transparent" />

        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="mb-0.5 block font-sans text-[9px] tracking-widest text-white/28 uppercase">
              from
            </span>
            <div className="flex items-baseline gap-1">
              <span className="font-serif text-[32px] leading-none tracking-tight text-white/95">
                €{hotel.price}
              </span>
              <span className="font-sans text-[11px] text-white/32">/night</span>
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            className="h-auto rounded-xl border-0 bg-white/95 px-4 py-2.5 font-sans text-[10px] font-semibold tracking-[0.07em] text-[#111] uppercase shadow-none transition-[transform,background-color] duration-200 hover:scale-[1.04] hover:bg-white"
          >
            Explore →
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
