import Image from "next/image";
import { isTransformable, type Backdrop } from "@openbookings/images";

/**
 * The search page's background: the photo, blurred under a 70% black layer, so
 * content reads over it without a card behind every line. Fixed, behind
 * everything (DESIGN_SYSTEM.md §3.2 page scaffold).
 */
export function GlassBackdrop({ backdrop }: { backdrop: Backdrop | null }) {
  return (
    <div aria-hidden className="fixed inset-0 bg-black">
      {backdrop && (
        // Deliberately low resolution: under the blur and the black layer, a
        // quarter-width, low-quality image is indistinguishable. AVIF can't be
        // resized by the CDN, so it is served as-is (`unoptimized`).
        <Image
          src={backdrop.url}
          alt=""
          fill
          sizes="25vw"
          quality={40}
          unoptimized={!isTransformable(backdrop.url)}
          className="object-cover object-center"
        />
      )}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
    </div>
  );
}
