"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";

/** Unmissable, because every figure below it is invented. */
export function DemoBanner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Dropping the flag, not the page or the period.
  const params = new URLSearchParams(searchParams.toString());
  params.delete("demo");
  const query = params.toString();

  return (
    <div className="flex items-center gap-2 border-(--amber-11)/30 border-b bg-(--amber-3) px-4 py-2 text-(--amber-11) text-sm lg:px-6">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span>
        Demo data: none of these numbers are yours.{" "}
        <Link href={query ? `${pathname}?${query}` : pathname} className="underline">
          Back to your own analytics
        </Link>
        .
      </span>
    </div>
  );
}
