"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Heart,
  MapPin,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** Card + image block behind the wave clip (same fill in both places). */
const CARD_BODY_BG = "rgba(18,17,26,0.82)";

/** Hero image aspect — keeps image height locked to the same width as the card. */
const IMAGE_ASPECT = "280 / 210" as const;

export type HotelCardData = {
  id: string;
  name: string;
  slug: string,
  distance: string;
  rating: number;
  reviews: number;
  price: number;
  tags: string[];
  description: {
    type: string;
    bed: string;
    size: string;
  };
  images: string[];
};

function buildHotelImageUrl(hotelId: string, image: string): string {
  if (!image) return "";

  if (image.startsWith("http://") || image.startsWith("https://")) {
    return image;
  }

  if (image.startsWith("//")) {
    return `https:${image}`;
  }

  const normalizedImagePath = image.replace(/^\/+/, "");
  return `https://images.openbookings.co/${hotelId}/${normalizedImagePath}`;
}

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
      <div className="absolute inset-0 overflow-hidden">
        <img
          src={currentSrc}
          alt={hotelName}
          loading="lazy"
          draggable="false"
          className="block size-full object-cover object-[center_15%] transition-transform duration-600 ease-out group-hover:scale-105"
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[60px] bg-linear-to-b from-black/25 to-transparent" />
      </div>

      {hasGallery ? (
        <span className="pointer-events-none absolute left-3 bottom-3 z-10 inline-flex h-6 items-center rounded-full border border-white/22 bg-white/14 px-2.5 font-sans text-[10px] font-medium tracking-[0.08em] text-white backdrop-blur-sm">
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
    hotel.images?.filter(Boolean).map((image) => buildHotelImageUrl(hotel.id, image)) ?? [];
  const displayRating = Math.round(
    Number.isFinite(hotel.rating) ? hotel.rating : 0,
  );
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
      />

      <CardContent
        className="-mt-px flex min-h-0 flex-1 flex-col px-[clamp(14px,5cqw,22px)] pt-[clamp(10px,3.8cqw,14px)] pb-[clamp(14px,5.4cqw,22px)] backdrop-blur-xl"
        style={{ backgroundColor: CARD_BODY_BG }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative mb-[clamp(4px,2.2cqw,8px)]">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1 pr-3">
                <h3 className="font-serif text-[clamp(1.1rem,7cqw,1.35rem)] font-bold leading-tight tracking-tight text-white/97">
                  <span className="line-clamp-2 wrap-break-words">{hotel.name}</span>
                </h3>
              </div>
              <div
                className="flex shrink-0 items-center gap-1 rounded-lg bg-white/12 px-2 py-1"
                aria-label={`Rating: ${displayRating} out of 10, ${hotel.reviews} reviews`}
              >
                <Star className="size-3 fill-[#E6C97B] text-[#E6C97B]" aria-hidden />
                <span className="font-sans text-sm font-semibold leading-none text-white">
                  {displayRating}
                </span>
              </div>
            </div>
          </div>

          <div className="mb-[clamp(14px,5.2cqw,20px)]">
            <div className="mb-2.5 flex items-center truncate font-sans text-[clamp(12.5px,3.3cqw,14px)] leading-snug text-white/42">
              <MapPin
                aria-hidden
                strokeWidth={1.6}
                style={{ width: 13, height: 13, flexShrink: 0, marginRight: 4, opacity: 0.7 }}
              />
              <span className="truncate">{hotel.distance}</span>
            </div>

            <div className="mb-2.5 flex flex-wrap items-center gap-x-1 gap-y-0 overflow-hidden font-sans text-[clamp(13px,3.5cqw,14.5px)] leading-snug tracking-wide text-white/70" style={{ maxHeight: "calc(2 * 1.4em)" }}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                fill="currentColor"
                viewBox="0 0 16 16"
                aria-hidden
              >
                <path d="M8.5 10c-.276 0-.5-.448-.5-1s.224-1 .5-1 .5.448.5 1-.224 1-.5 1" />
                <path d="M10.828.122A.5.5 0 0 1 11 .5V1h.5A1.5 1.5 0 0 1 13 2.5V15h1.5a.5.5 0 0 1 0 1h-13a.5.5 0 0 1 0-1H3V1.5a.5.5 0 0 1 .43-.495l7-1a.5.5 0 0 1 .398.117M11.5 2H11v13h1V2.5a.5.5 0 0 0-.5-.5M4 1.934V15h6V1.077z" />
              </svg>
              <span>{hotel.description.type}</span>
              <span aria-hidden className="mx-1 opacity-40">
                ·
              </span>
              <span>{hotel.description.bed}</span>
              <span aria-hidden className="mx-1 opacity-40">
                ·
              </span>
              <span>{hotel.description.size}</span>
            </div>

            <div
              className="mb-1.5 flex items-center gap-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap font-sans text-[clamp(13px,3.5cqw,14.5px)] leading-snug text-white/70 [scrollbar-width:none]"
              tabIndex={0}
              aria-label="Hotel amenities"
            >
              {hotel.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex min-h-8 items-center rounded-full border border-[#C9A84C]/50 bg-[rgba(201,168,76,0.15)] px-[clamp(10px,3.2cqw,12px)] py-[clamp(2px,0.8cqw,3px)] font-sans text-[clamp(9px,2.5cqw,10px)] font-semibold tracking-widest whitespace-nowrap text-[#E6C97B] uppercase"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        <Separator className="mb-[clamp(12px,4.3cqw,18px)] h-px shrink-0 bg-linear-to-r from-white/10 to-transparent" />
        <div className="flex shrink-0 items-end justify-between gap-3">
          <div>
            <span className="block font-sans text-[clamp(10px,2.8cqw,11px)] text-[rgba(255,255,255,0.52)] uppercase">
              from
            </span>
            <div className="flex items-baseline gap-1">
              <span className="font-sans text-[clamp(24px,9cqw,32px)] leading-none font-semibold tracking-tight text-white/95">
                €{hotel.price}
              </span>
              <span className="font-sans text-[clamp(12px,3.7cqw,14px)] font-normal text-[rgba(255,255,255,0.52)]">
                /night
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Save to wishlist"
              className="flex size-8 items-center justify-center rounded-full bg-white/12 transition-colors duration-200 hover:bg-white/20"
            >
              <Heart className="size-4 text-white" aria-hidden />
            </button>
            <Button
              type="button"
              size="sm"
              className="h-auto rounded-xl border border-[#E0BE69]/70 bg-[#C9A84C] px-[clamp(12px,4cqw,17px)] py-[clamp(8px,2.9cqw,11px)] font-sans text-[clamp(9.5px,2.55cqw,10.5px)] font-semibold tracking-[0.07em] text-white uppercase transition-[transform,background-color,border-color] duration-200 hover:scale-[1.04] hover:border-[#E9C773] hover:bg-[#D6B35A]"
            >
              Explore
              <ArrowRight className="size-4" strokeWidth={2.1} aria-hidden />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
