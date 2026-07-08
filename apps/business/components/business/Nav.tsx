"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

const NAV_HEIGHT = 68;

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
      className="fixed top-0 left-0 right-0 z-100 flex items-center justify-between px-16 py-[18px]"
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
        <div className="absolute inset-0 bg-white/[0.03] [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" />
      </div>
      <div className="flex items-center gap-[11px]">
        <Image src="/OB-LOGO-LIGHT.png" alt="OpenBookings Business" width={100} height={100} />
        <span className="text-[15px] font-medium tracking-[-0.02em] text-white">
          OpenBookings <span className="text-white/38">Business</span>
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <Link
          href="/login"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/7 border border-white/11 text-[14px] text-white/60 hover:bg-white/10 transition-colors"
          aria-label="Help"
        >
          ?
        </Link>
        <Link
          href="/login"
          className="rounded-lg bg-white px-6 py-2.5 text-[14px] font-medium tracking-[-0.01em] text-[#0d1117] hover:opacity-90 transition-opacity"
        >
          Get Started
        </Link>
      </div>
    </nav>
  );
}
