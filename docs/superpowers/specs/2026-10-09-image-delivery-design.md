# Image delivery and lazy loading

Date: 2026-10-09
Status: awaiting review

## Goal

Guests and hosts should download images at the size and format their screen
needs, see above-the-fold images first, and not pay for anything below the
fold until they get near it. Applies to `apps/web` and `apps/business`.

Success means:

- Every CDN-hosted raster image is requested through a resizing URL at a width
  close to its rendered size, in AVIF or WebP where the browser supports it.
- The largest above-the-fold image on the hotel, home, search and checkout
  pages is discoverable in the HTML and fetched at high priority.
- Images below the fold load lazily and reserve their space (no layout shift).
- `maplibre-gl` is not in the initial bundle of any page where the map sits
  below the fold.
- CDN responses are cached for long enough that a returning visitor does not
  re-download them.

## Starting point

- 30+ raw `<img>` tags, two `next/image` usages, one `loading="lazy"`. No
  `images` block in any `next.config`.
- Host uploads go to R2 as JPEG/PNG/WebP originals and are served as-is.
- The hotel hero, room carousel and the home/search/login backdrops are CSS
  `background-image`, so they are invisible to the preload scanner and cannot
  be sized responsively. The home backdrop is set in a `useEffect` via the
  Cache API and a blob URL.
- Static assets in `public/` are oversized: `founder.png` 1.8 MB,
  `OB-LIGHT-WORDMARK.png` 1.2 MB, three logo PNGs ~600 KB each, a 115 KB SVG.
- No `next/dynamic` anywhere.
- Everything on `cdn.openbookings.co` is served with `max-age=14400`; uploads
  set no `Cache-Control`.

## Decisions

1. **Resizing happens at Cloudflare**, through `/cdn-cgi/image/` on
   `cdn.openbookings.co`. Image Transformations is enabled on the zone
   (verified 2026-10-09: JPEG and PNG sources transform, `format=auto`
   negotiates AVIF/WebP/original).
2. **Call sites use `next/image` with a custom loader**, not hand-written
   `srcSet`. This gives lazy loading, preload and reserved space without
   re-implementing them.
3. **No feature flag.** Transformations are already on, and every URL carries
   `onerror=redirect`, so a failed transform falls back to the original.
4. **AVIF sources are never sent to the transformer.** Cloudflare accepts AVIF
   input only on Enterprise (error 9520). The loader returns `.avif` URLs
   unchanged.
5. **A short fixed width ladder.** Cloudflare bills per unique
   source-and-parameters pair per calendar month (5,000 free, then $0.50 per
   1,000; on the free plan the excess returns error 9422 instead of a charge).
   Fewer widths means fewer unique transformations.

## Design

### 1. `packages/images`

A new workspace package, shaped like `packages/maps`: pure functions, no React,
unit-tested with `bun test`.

- `cdnImageUrl(src, { width, quality? })` returns the URL to request.
  - `https://cdn.openbookings.co/<path>` becomes
    `https://cdn.openbookings.co/cdn-cgi/image/width=<w>,quality=<q>,format=auto,onerror=redirect/<path>`.
  - Returned unchanged: any other host (Google avatars, Stripe artwork),
    `blob:` and `data:` URLs, relative `/public` paths, `.avif` and `.svg`
    sources, and URLs that already contain `/cdn-cgi/image/`.
  - Default quality 75.
- `cdnImageSrcSet(src, widths)` for the few places that stay plain `<img>`.
- `IMAGE_WIDTHS`: the ladder, exported so both `next.config` files and the
  helper agree. Starting point: `96, 256, 480, 960, 1440, 1920, 2560`, split
  between `imageSizes` and `deviceSizes`.

Each app adds a one-line loader file that adapts `cdnImageUrl` to the
`next/image` loader signature, sets `images.loaderFile` and the two size
arrays in `next.config.ts`, and adds the package to `transpilePackages`.

CSP needs no change: `img-src` already allows `https://*.openbookings.co`.

### 2. Guest app (`apps/web`)

| Component | Change |
|---|---|
| `p/[hotel_slug]/_components/HeroSection` | Background div becomes `Image fill`, preloaded, `sizes="100vw"`. Gradient overlay stays as a sibling. |
| `app/page.tsx` backdrop | Remove the Cache API and blob URL path. Keep the random pick and its `localStorage` persistence. Render an image with high fetch priority, `sizes="100vw"`. |
| `app/search/page.tsx` backdrop | Same, but it sits under `backdrop-blur` and a 70% black layer, so it requests a single small width at low quality. |
| `checkout/_components/Backdrop` | Through the loader at a reduced width and quality; it is blurred and under a heavy scrim. Remove the stale "no remote patterns" comment. |
| `GalleryBar` strip | Tiles are 195×130: `Image` with `sizes="195px"`, lazy. The 4× repeat is unchanged (same URLs, no extra downloads). |
| `GalleryBar` dialog | Stays `motion.img`; gains `srcSet` and `sizes` from `cdnImageSrcSet`. Still mounts only when opened. |
| `RoomsCarousel` | Background div becomes `Image fill` inside the existing `motion.div`, lazy, `sizes` matching the card. |
| `search/HotelCard` | `Image fill` with `sizes` matching the results grid. Cards in the first row load eagerly; the rest lazily. |
| `checkout/TripSummary`, `PaymentCard`, `CheckoutGate` | Room thumbnail and logos through the loader at display size. |
| `nav`, `auth/*`, `legal/LegalDocument`, `FootnoteSection`, `PoliciesSection` | Logos through the loader with explicit width and height. |
| `LocationSection`, `GeneralMap` | The map component is loaded with `next/dynamic` (`ssr: false`) from a small client wrapper that mounts it when the section is within roughly one viewport, with a same-size placeholder. |

### 3. Business app (`apps/business`)

- Through the loader, lazy, at display size: room covers in `rooms-index`,
  thumbnails in `image-manager`, message avatars, sidebar brand, onboarding
  layout logo, auth screens, `AuthLoadingScreen`, and the login backdrop.
- Unchanged plain `<img>`: upload previews, which are `blob:` URLs.
- Map editors in onboarding (`core-info-location`) and listings
  (`sections/location`) load via `next/dynamic`.
- The marketing `Nav` wordmark moves from raw `<img>` to `Image`.

### 4. Static assets

A custom loader turns off Next's built-in optimisation for `/public` files, so
they are fixed at the source. Resize and recompress in place to twice their
largest rendered size: `founder.png`, `OB-LIGHT-WORDMARK.png`,
`OB-LOGO-LIGHT.png` (both apps), `OB-LOGO-DARK.png`, and run the 115 KB
`Openbookings-logo-v2.svg` through an SVG optimiser. Unused files found along
the way are reported, not deleted.

### 5. Backdrops

The 20 files under `Public/backgrounds/` are AVIF and cannot be transformed.
Wouter locates the originals and uploads JPEG or WebP masters. Once uploaded,
`backgrounds.json` in both apps is updated to the new filenames. Until then
the loader passes the AVIF URLs through and the backdrops behave as today.

### 6. Caching

- **New uploads**: the presign route signs
  `Cache-Control: public, max-age=31536000, immutable` into the `PutObject`
  command. Keys are random UUIDs, so content at a URL never changes. Both
  upload clients (`image-manager` and `RoomImageUploader`) must send the same
  header or R2 rejects the signature. If the confirm route copies the object
  to a final key, the header must survive the copy.
- **Existing and fixed-name objects**: a Cloudflare Cache Rule on
  `cdn.openbookings.co`, configured by Wouter in the dashboard. UUID-named
  uploads get a long TTL; fixed-name files that can be overwritten in place
  (`hero-image.jpg`, `logo.svg`, `Public/backgrounds/*`, the platform logo)
  get about a week.
- After the rule is live, re-probe a transformed URL to confirm it inherits
  the new TTL. This has not been verified.

## Error handling

- Transform failure of any kind: `onerror=redirect` sends the browser to the
  original. Worst case is today's behaviour plus one redirect.
- Missing or empty image URL: call sites keep their existing guards (for
  example `property-brand.ts` already refuses a blank logo URL). The loader is
  never called with an empty string.
- Free-tier exhaustion (error 9422): handled by the same redirect. Already
  cached variants keep serving.

## Testing

- `packages/images` unit tests: CDN rewrite, each pass-through case, quality
  default, already-transformed input, width ladder.
- `turbo run typecheck lint test build` for `web` and `business`.
- Presign route: test that the signed command carries the cache header.
- Browser check on the hotel, search, home and checkout pages: network panel
  shows `/cdn-cgi/image/` requests at sensible widths, the hero is preloaded,
  below-the-fold images and the map chunk load on scroll, no layout shift.
- Header probe with `curl` for cache behaviour once the Cache Rule exists.

## Out of scope

- Compressing or generating variants at upload time.
- Blur-up placeholders; no image dimensions or blur data are stored.
- Email templates, `apps/docs`, the Open Graph image.
- Lazy-loading Recharts and Stripe; those pages exist to show them.
- Backfilling `Cache-Control` metadata on existing R2 objects (the Cache Rule
  covers them).

## Depends on Wouter

1. Upload JPEG/WebP backdrop masters and share the filenames.
2. Create the Cache Rule on `cdn.openbookings.co`.

Neither blocks the code changes.
