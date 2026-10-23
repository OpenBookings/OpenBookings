"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

// Tallest layout: 32px padding + 64px logo + 32px padding.
const NAV_HEIGHT = 128;

const GITHUB_URL = "https://github.com/OpenBookings/OpenBookings";

// lucide-react no longer ships brand marks, so the GitHub mark is inlined.
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const blurLayers = [
  {
    blur: "backdrop-blur-[24px]",
    mask: "[mask-image:linear-gradient(to_bottom,black_0%,black_20%,transparent_45%)]",
  },
  {
    blur: "backdrop-blur-[12px]",
    mask: "[mask-image:linear-gradient(to_bottom,transparent_5%,black_25%,black_40%,transparent_60%)]",
  },
  {
    blur: "backdrop-blur-[6px]",
    mask: "[mask-image:linear-gradient(to_bottom,transparent_30%,black_50%,black_60%,transparent_80%)]",
  },
  {
    blur: "backdrop-blur-[2px]",
    mask: "[mask-image:linear-gradient(to_bottom,transparent_55%,black_75%,black_85%,transparent_100%)]",
  },
];

export function Nav() {
  const [scrolledPastHero, setScrolledPastHero] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("hero");
    if (!hero) return;

    const observer = new IntersectionObserver(
      ([entry]) => setScrolledPastHero(!entry.isIntersecting),
      { rootMargin: `-${NAV_HEIGHT}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-100 flex items-center justify-between p-4 sm:p-6 md:p-8"
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 -z-10 transition-opacity duration-300 ${
          scrolledPastHero ? "opacity-100" : "opacity-0"
        }`}
      >
        {blurLayers.map(({ blur, mask }) => (
          <div key={blur} className={`absolute inset-0 ${blur} ${mask}`} />
        ))}
        <div className="absolute inset-0 bg-white/3 mask-[linear-gradient(to_bottom,black_0%,transparent_100%)]" />
      </div>
      <Image
        src="https://cdn.openbookings.co/Public/OB-LIGHT-WORDMARK.png"
        // The wordmark is 5:1 (600x120); this is its largest rendered size
        // (md:h-10), so the CDN serves 256px at 1x and 480px at 2x.
        width={200}
        height={40}
        preload
        alt="OpenBookings"
        className="h-6 sm:h-8 md:h-10 w-auto select-none pointer-events-none"
        draggable={false}
      />
      <div className="flex items-center gap-2 sm:gap-3">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="OpenBookings on GitHub"
          className="flex size-10 sm:size-11 md:size-12 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/30 backdrop-blur-2xl shadow-2xl text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <GitHubMark className="size-[45%]" />
        </a>
        {/* Same glass button as the guest site's "Get Started" (apps/web CS-AuthForm). */}
        <Link
          href="/login"
          className="aspect-3/1 min-w-30 flex items-center justify-center rounded-lg sm:rounded-xl border border-white/20 bg-black/30 backdrop-blur-2xl shadow-2xl px-6 py-2 text-base sm:text-lg font-normal whitespace-nowrap text-white hover:bg-white/10 transition-colors"
        >
          Get Started
        </Link>
      </div>
    </nav>
  );
}
