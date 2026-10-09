const CDN_ORIGIN = "https://cdn.openbookings.co";
const TRANSFORM_PREFIX = "/cdn-cgi/image/";

/**
 * The only widths the apps ever request. Cloudflare bills per unique
 * source-and-parameters pair, so every extra width here multiplies the
 * transformation count by the number of images on the platform.
 */
export const IMAGE_SIZES = [96, 256, 480] as const;
export const DEVICE_SIZES = [960, 1440, 1920, 2560] as const;

/** 40 is for backdrops that sit under a blur and a scrim; 75 is everything else. */
export const IMAGE_QUALITIES = [40, 75] as const;

const DEFAULT_QUALITY = 75;

/**
 * Whether Cloudflare can resize this source. AVIF is accepted as an input
 * format only on Enterprise plans (error 9520 otherwise), and SVG is returned
 * unchanged while still counting as a transformation — so neither is sent.
 */
export function isTransformable(src: string): boolean {
  if (!src.startsWith(`${CDN_ORIGIN}/`)) return false;
  const path = src.slice(CDN_ORIGIN.length).split(/[?#]/)[0];
  if (path.startsWith(TRANSFORM_PREFIX)) return false;
  return !/\.(avif|svg)$/i.test(path);
}

/**
 * `onerror=redirect` makes any failed transform fall back to the original
 * file, so the worst case is the unoptimised image plus one redirect.
 */
export function cdnImageUrl(src: string, { width, quality }: { width: number; quality?: number }): string {
  if (!isTransformable(src)) return src;
  if (!Number.isFinite(width) || width < 1) return src;
  const path = src.slice(CDN_ORIGIN.length + 1);
  const options = `width=${Math.round(width)},quality=${quality ?? DEFAULT_QUALITY},format=auto,fit=scale-down,onerror=redirect`;
  return `${CDN_ORIGIN}${TRANSFORM_PREFIX}${options}/${path}`;
}

/** For the few plain `<img>` elements that cannot be `next/image`. */
export function cdnImageSrcSet(src: string, widths: readonly number[], quality?: number): string | undefined {
  if (!isTransformable(src)) return undefined;
  return widths.map((width) => `${cdnImageUrl(src, { width, quality })} ${width}w`).join(", ");
}
