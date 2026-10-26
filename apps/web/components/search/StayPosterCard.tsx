"use client";

import { useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  coverPosition,
  posterEyebrow,
  posterPrice,
  posterTags,
  POSTER_TINT_FALLBACK,
  type PriceMode,
  type StayPosterData,
} from "./stay-poster-data";

// Hover and keyboard focus look the same. `hover:` only applies on devices that
// can hover, so nothing sticks after a tap; focus follows `:focus-visible`.
const LIFT =
  "motion-safe:hover:-translate-y-[3px] motion-safe:has-[a:focus-visible]:-translate-y-[3px] motion-safe:active:translate-y-0";
const PUSH_IN = "motion-safe:group-hover:scale-106 motion-safe:group-has-[a:focus-visible]:scale-106";
const EDGE_ON =
  "group-hover:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)] group-has-[a:focus-visible]:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)]";
const CTA_LIFT = "motion-safe:group-hover:-translate-y-px motion-safe:group-has-[a:focus-visible]:-translate-y-px";

export function StayPosterCard({
  stay,
  priceMode,
  href,
  priority = false,
}: {
  stay: StayPosterData;
  priceMode: PriceMode;
  href: string;
  priority?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const { cover } = stay;
  const unavailable = stay.availability.status === "unavailable";
  const price = posterPrice(stay.availability, priceMode);
  const nameId = `stay-${stay.id}-name`;

  return (
    <div
      className={cn(
        "group relative rounded-poster shadow-poster",
        // The hover shadow sits on a pseudo-element and only its opacity animates,
        // so a full grid doesn't repaint shadows.
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:shadow-poster-hover before:opacity-0 before:content-['']",
        "before:transition-opacity before:duration-500 before:ease-poster hover:before:opacity-100 has-[a:focus-visible]:before:opacity-100",
        // Focus ring on the unclipped wrapper so it wraps the whole card and follows its radius.
        "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-white",
        "motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-poster",
        LIFT,
      )}
    >
      <article
        aria-labelledby={nameId}
        style={{ "--tint": cover?.tint ?? POSTER_TINT_FALLBACK } as CSSProperties}
        className="relative isolate flex aspect-[2/3] flex-col justify-end overflow-hidden rounded-poster bg-(--tint) font-sans text-white"
      >
        {cover && !failed ? (
          <div
            data-loaded={loaded}
            className="absolute inset-0 -z-20 opacity-0 transition-opacity duration-300 ease-out data-[loaded=true]:opacity-100 motion-reduce:transition-none"
          >
            <Image
              src={cover.url}
              alt=""
              fill
              sizes="(max-width: 639px) calc(100vw - 32px), (max-width: 891px) 50vw, 336px"
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : undefined}
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              style={{ objectPosition: coverPosition(cover) }}
              className={cn(
                "origin-[50%_40%] object-cover transition-transform duration-[1400ms] ease-poster",
                PUSH_IN,
                unavailable && "brightness-60 grayscale-80",
              )}
            />
          </div>
        ) : null}

        <div aria-hidden className="poster-scrim pointer-events-none absolute inset-0 -z-10" />

        {/* Not positioned, so the link's ::after stretches over the whole article. */}
        <div className="pointer-events-none px-5 pb-5">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-white/74">
            {posterEyebrow(stay)}
          </p>
          <h3
            id={nameId}
            className="mt-2 line-clamp-2 font-serif text-[28px] leading-[1.08] tracking-[-0.01em] text-balance text-white"
          >
            <Link
              href={href}
              title={stay.name}
              className="pointer-events-auto focus-visible:outline-none after:absolute after:inset-0 after:z-10 after:content-['']"
            >
              {stay.name}
            </Link>
          </h3>
          <p className="mt-2.5 line-clamp-2 text-[13px] leading-[1.4] text-white/78">
            {posterTags(stay).join(" • ")}
          </p>
          <div aria-hidden className="mt-4 h-px bg-white/14" />
          <div className="mt-3.5 flex items-end justify-between gap-3">
            <div className="min-w-0">
              {price.kind === "price" ? (
                <>
                  {/* Neither span may break inside; on a cramped card the unit wraps below the amount. */}
                  <p className="flex flex-wrap items-baseline gap-x-1.5">
                    <span
                      className={cn(
                        "font-serif whitespace-nowrap text-white",
                        // Size and line-height together: tailwind-merge drops a separate leading-* after a text size.
                        price.long ? "text-[22px]/none" : "text-[26px]/none",
                      )}
                    >
                      {price.amount}
                    </span>
                    <span className="whitespace-nowrap text-xs text-white/72">{price.unit}</span>
                  </p>
                  <p className="mt-[5px] truncate text-xs leading-[1.4] text-white/66">{price.detail}</p>
                </>
              ) : (
                <>
                  <p className="text-[15px] font-semibold text-white/90">{price.heading}</p>
                  {price.detail ? (
                    <p className="mt-[5px] truncate text-xs leading-[1.4] text-white/66">{price.detail}</p>
                  ) : null}
                </>
              )}
            </div>
            <span
              aria-hidden
              className={cn(
                "flex h-11 shrink-0 items-center rounded-cta text-xs font-bold uppercase tracking-[0.12em]",
                "motion-safe:transition-transform motion-safe:duration-300",
                CTA_LIFT,
                price.cta === "View"
                  ? "bg-white px-[18px] text-[#111114]"
                  : "border border-white/50 px-4 text-white",
              )}
            >
              {price.cta}
            </span>
          </div>
        </div>

        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-20 rounded-poster shadow-[inset_0_0_0_1px_rgb(255_255_255/0.09)]",
            "transition-shadow duration-400 ease-[ease]",
            EDGE_ON,
          )}
        />
      </article>
    </div>
  );
}
