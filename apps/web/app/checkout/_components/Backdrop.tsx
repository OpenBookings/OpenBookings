import Image from "next/image";

/**
 * Full-bleed host photograph behind the checkout surfaces.
 *
 * Fixed rather than set on the page background, so it stays put while a tall
 * payment form scrolls, and the gradient scrim keeps white text legible
 * whatever the host uploads.
 *
 * Lives in its own file because three surfaces share it — the gate, the
 * checkout itself and the error notice — and they must agree pixel for pixel:
 * the gate fades out over the checkout, so any difference in blur or scrim
 * would read as the photograph twitching at the moment of handover.
 */
export function Backdrop({ heroImageUrl }: { heroImageUrl: string }) {
  return (
    <div className="fixed inset-0 -z-10 bg-black" aria-hidden="true">
      {heroImageUrl && (
        // Half-width and low quality: the photo is blurred and sits under a
        // heavy scrim, so the detail would never be seen.
        <Image
          src={heroImageUrl}
          alt=""
          fill
          sizes="50vw"
          quality={40}
          preload
          className="scale-105 object-cover blur-[2px]"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-br from-black/90 via-black/75 to-black/55" />
    </div>
  );
}
