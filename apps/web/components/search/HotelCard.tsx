"use client";

import { Fragment, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Star,
} from "lucide-react";
import { DoorIcon } from "@/components/Icons";
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
      style={{ aspectRatio: IMAGE_ASPECT }}
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
        <span className="pointer-events-none absolute left-3 bottom-3 z-10 inline-flex h-6 items-center rounded-full border border-white/22 bg-white/14 px-2.5 font-sans text-[11px] font-medium tracking-[0.08em] text-white backdrop-blur-sm">
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
              "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:size-11",
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
              "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:size-11",
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
      className="group relative h-full w-full min-w-0 gap-0 overflow-hidden rounded-2xl border border-white/20 bg-black/70 py-0 backdrop-blur-md @container shadow-2xl has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-white/70"
    >
      <HotelCardHeroImage
        eager={eager}
        key={hotel.id}
        gallery={gallery}
        hotelName={hotel.name}
      />

      <CardContent
        className="flex min-h-0 flex-1 flex-col px-[clamp(14px,5cqw,22px)] pt-[clamp(10px,3.8cqw,14px)] pb-[clamp(14px,5.4cqw,22px)]"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-[clamp(4px,2.2cqw,8px)]">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1 pr-3">
                <h3 className="font-serif text-[clamp(1.1rem,7cqw,1.35rem)] font-bold leading-snug tracking-tight text-white">
                  <Link
                    href={`/p/${hotel.slug}`}
                    className="line-clamp-2 outline-hidden after:absolute after:inset-0 after:z-0 after:content-['']"
                  >
                    {hotel.name}
                  </Link>
                </h3>
              </div>
              {rating ? (
                <div
                  className="flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-1"
                  role="img"
                  aria-label={rating.label}
                >
                  <Star className="size-3 fill-rating text-rating" aria-hidden />
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
            <div className="mb-2.5 flex items-center truncate font-sans text-[clamp(12.5px,3.3cqw,14px)] leading-snug text-white/60">
              <MapPin
                aria-hidden
                strokeWidth={1.6}
                className="mr-1 size-[13px] shrink-0 opacity-70"
              />
              <span className="truncate">{hotel.location}</span>
            </div>

            <div className="mb-2.5 flex flex-wrap items-center gap-x-1 gap-y-0 overflow-hidden font-sans text-[clamp(13px,3.5cqw,14.5px)] leading-snug tracking-wide text-white/70 max-h-[2.8em]">
              <DoorIcon className="size-4 shrink-0" />
              {room.map((part, i) => (
                <Fragment key={i}>
                  {i > 0 ? (
                    <span aria-hidden className="mx-1 opacity-40">
                      ·
                    </span>
                  ) : null}
                  <span>{part}</span>
                </Fragment>
              ))}
            </div>

            <p
              className={cn(
                "flex items-center gap-1.5 font-sans text-[13px] font-medium",
                hotel.freeCancellation ? "text-emerald-300" : "text-white/60",
              )}
            >
              {hotel.freeCancellation ? (
                <Check className="size-3.5" aria-hidden />
              ) : null}
              {hotel.freeCancellation ? "Free cancellation" : "Non-refundable"}
            </p>
          </div>
        </div>

        <Separator className="mb-[clamp(12px,4.3cqw,18px)] h-px shrink-0 bg-linear-to-r from-white/10 to-transparent" />
        <div className="flex shrink-0 items-end justify-between gap-3">
          <div>
            {price.caption ? (
              <span className="block font-sans text-[clamp(10px,2.8cqw,11px)] text-white/60 uppercase">
                {price.caption}
              </span>
            ) : null}
            <div className="flex items-baseline gap-1">
              <span className="font-sans text-[clamp(24px,9cqw,32px)] leading-none whitespace-nowrap font-semibold tracking-tight text-white">
                {price.amount}
              </span>
              <span className="font-sans text-[clamp(12px,3.7cqw,14px)] font-normal text-white/60">
                {price.suffix}
              </span>
            </div>
            {price.detail ? (
              <span className="mt-1 block font-sans text-[12px] text-white/60">
                {price.detail}
              </span>
            ) : null}
          </div>

          <span
            aria-hidden="true"
            className="rounded-xl border border-white/20 bg-white/10 px-[clamp(12px,4cqw,17px)] py-[clamp(8px,2.9cqw,11px)] font-sans text-[clamp(12px,3cqw,15px)] font-semibold tracking-[0.04em] text-white transition-all duration-200 group-hover:bg-white/20"
            >
            Explore
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
