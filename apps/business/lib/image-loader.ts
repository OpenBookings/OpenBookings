"use client";

import { cdnImageUrl } from "@openbookings/images";

// Registered as `images.loaderFile`, so every `next/image` in this app goes
// through here. Sources Cloudflare cannot resize are returned unchanged.
export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  return cdnImageUrl(src, { width, quality });
}
