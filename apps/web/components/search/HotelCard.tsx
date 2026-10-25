"use client";

import type { CSSProperties } from "react";
import { Fragment, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  formatRating,
  photoAlt,
  priceSummary,
  roomDetails,
  type HotelCardData,
} from "./hotel-card-data";

const CARD_BODY_BG = "rgba(0,0,0,0.70)";

/** Hero image aspect — keeps image height locked to the same width as the card. */
const IMAGE_ASPECT = "280 / 210" as const;

function buildHotelImageUrl(hotelId: string, image: string): string {
  if (!image) return "";

  if (image.startsWith("http://") || image.startsWith("https://")) {
    return image;
  }

  if (image.startsWith("//")) {
    return `https:${image}`;
  }

  const normalizedImagePath = image.replace(/^\/+/, "");
  return `https://cdn.openbookings.co/${hotelId}/${normalizedImagePath}`;
}

function HotelCardHeroImage({
  gallery,
  hotelName,
  eager,
}: {
  gallery: string[];
  hotelName: string;
  eager: boolean;
}) {
  const [imageIndex, setImageIndex] = useState(0);
  const hasGallery = gallery.length > 1;
  const currentSrc = gallery[imageIndex] ?? gallery[0];

  return (
    <div
      className="relative w-full shrink-0"
      style={
        {
          aspectRatio: IMAGE_ASPECT,
          backgroundColor: CARD_BODY_BG,
        } satisfies CSSProperties
      }
    >
      <div className="absolute inset-0 overflow-hidden">
        {currentSrc ? (
          <Image
            src={currentSrc}
            alt={photoAlt(hotelName, imageIndex, gallery.length)}
            fill
            sizes="(min-width: 1024px) 320px, (min-width: 768px) 50vw, 100vw"
            loading={eager ? "eager" : "lazy"}
            draggable={false}
            className="object-cover object-[center_15%] transition-transform duration-600 ease-out group-hover:scale-105"
          />
        ) : null}
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
              "group-hover:pointer-events-auto group-hover:opacity-100",
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
              "group-hover:pointer-events-auto group-hover:opacity-100",
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

export function HotelCard({ hotel, eager = false }: { hotel: HotelCardData; eager?: boolean }) {
  const gallery =
    hotel.images?.filter(Boolean).map((image) => buildHotelImageUrl(hotel.id, image)) ?? [];
  const rating = formatRating(hotel.rating, hotel.reviews);
  const room = roomDetails(hotel.description);
  const price = priceSummary(hotel);
  return (
    <Card
      className={cn(
        "group relative h-full w-full min-w-0 gap-0 overflow-hidden rounded-2xl border border-white/20 bg-transparent py-0 backdrop-blur-md @container shadow-[0_8px_32px_rgba(0,0,0,0.35),0_2px_8px_rgba(0,0,0,0.2)] transition-[transform,box-shadow] duration-300 ease-out hover:shadow-[0_16px_48px_rgba(0,0,0,0.5)] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-white/70",
      )}
      style={
        {
          backgroundColor: CARD_BODY_BG,
        } satisfies CSSProperties
      }
    >
      <HotelCardHeroImage
        eager={eager}
        key={hotel.id}
        gallery={gallery}
        hotelName={hotel.name}
      />

      <CardContent
        className="-mt-px flex min-h-0 flex-1 flex-col px-[clamp(14px,5cqw,22px)] pt-[clamp(10px,3.8cqw,14px)] pb-[clamp(14px,5.4cqw,22px)]"
        style={{ backgroundColor: CARD_BODY_BG }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-[clamp(4px,2.2cqw,8px)]">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1 pr-3">
                <h3 className="font-serif text-[clamp(1.1rem,7cqw,1.35rem)] font-bold leading-snug tracking-tight text-white/97">
                  <Link
                    href={`/p/${hotel.slug}`}
                    className="line-clamp-2 outline-none after:absolute after:inset-0 after:z-0 after:content-['']"
                  >
                    {hotel.name}
                  </Link>
                </h3>
              </div>
              {rating ? (
                <div
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-2 py-1"
                  aria-label={rating.label}
                >
                  <Star className="size-3 fill-[#E6C97B] text-[#E6C97B]" aria-hidden />
                  <span className="font-sans text-sm font-semibold leading-none text-white">
                    {rating.value}
                  </span>
                  <span className="font-sans text-xs font-normal leading-none text-white/60">
                    ({rating.count})
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mb-[clamp(14px,5.2cqw,20px)]">
            <div className="mb-2.5 flex items-center truncate font-sans text-[clamp(12.5px,3.3cqw,14px)] leading-snug text-white/42">
              <MapPin
                aria-hidden
                strokeWidth={1.6}
                style={{ width: 13, height: 13, flexShrink: 0, marginRight: 4, opacity: 0.7 }}
              />
              <span className="truncate">{hotel.location}</span>
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
              {room.map((part, i) => (
                <Fragment key={part}>
                  {i > 0 ? (
                    <span aria-hidden className="mx-1 opacity-40">
                      ·
                    </span>
                  ) : null}
                  <span>{part}</span>
                </Fragment>
              ))}
            </div>

            <div
              className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 overflow-hidden"
              aria-label="Hotel amenities"
              style={{ maxHeight: "3.25rem" }}
            >
              <span className="inline-flex items-center rounded-lg border border-white/15 bg-white/10 px-[clamp(8px,2.8cqw,11px)] py-[clamp(2px,0.8cqw,4px)] font-sans text-[clamp(9px,2.5cqw,10px)] font-medium tracking-[0.08em] whitespace-nowrap text-white/60 uppercase">
                {hotel.freeCancellation ? "Free cancellation" : "Non-refundable"}
              </span>
            </div>
          </div>
        </div>

        <Separator className="mb-[clamp(12px,4.3cqw,18px)] h-px shrink-0 bg-linear-to-r from-white/10 to-transparent" />
        <div className="flex shrink-0 items-end justify-between gap-3">
          <div>
            {price.caption ? (
              <span className="block font-sans text-[clamp(10px,2.8cqw,11px)] text-[rgba(255,255,255,0.52)] uppercase">
                {price.caption}
              </span>
            ) : null}
            <div className="flex items-baseline gap-1">
              <span className="font-sans text-[clamp(24px,9cqw,32px)] leading-none font-semibold tracking-tight text-white/95">
                {price.amount}
              </span>
              <span className="font-sans text-[clamp(12px,3.7cqw,14px)] font-normal text-[rgba(255,255,255,0.52)]">
                {price.suffix}
              </span>
            </div>
            {price.detail ? (
              <span className="mt-1 block font-sans text-[12px] text-white/60">
                {price.detail}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-auto rounded-xl border border-white/20 bg-white/10 px-[clamp(12px,4cqw,17px)] py-[clamp(8px,2.9cqw,11px)] font-sans text-[clamp(12px,3cqw,15px)] font-semibold tracking-[0.04em] text-white shadow-none pointer-events-none transition-all duration-200 group-hover:bg-white/20"
            >
              Explore
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
