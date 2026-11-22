import Link from "next/link";
import type { ComponentProps } from "react";
import { switchesHotel } from "@/lib/hotel-switch-link";

/**
 * An in-console link. One that switches the hotel (`?property=`) is a plain
 * `<a>`, so the switch is a full document load and the sidebar follows; every
 * other link is a next/link without prefetch.
 */
export function ConsoleLink({ href, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  if (switchesHotel(href)) return <a href={href} {...props} />;
  return <Link href={href} prefetch={false} {...props} />;
}
