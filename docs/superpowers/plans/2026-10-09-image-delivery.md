# Image Delivery and Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve every CDN-hosted image at the size and format the screen needs, prioritise above-the-fold images, and defer everything below the fold, across `apps/web` and `apps/business`.

**Architecture:** A new pure package, `@openbookings/images`, rewrites `cdn.openbookings.co` URLs into Cloudflare `/cdn-cgi/image/` resizing URLs. Both apps register it as the global `next/image` loader, and call sites move from raw `<img>` and CSS backgrounds to `next/image`. The map library is split out with `next/dynamic`.

**Tech Stack:** Next.js 16.3 (App Router), React 19, Bun 1.3 (`bun test`), Turborepo, Cloudflare Image Transformations, R2 via the AWS S3 SDK.

**Spec:** `docs/superpowers/specs/2026-10-09-image-delivery-design.md`

## Global Constraints

- CDN origin is exactly `https://cdn.openbookings.co`. Only URLs on that origin are transformed.
- Transform URL shape: `https://cdn.openbookings.co/cdn-cgi/image/width=<w>,quality=<q>,format=auto,fit=scale-down,onerror=redirect/<path>`.
- Never transform `.avif` or `.svg` sources (any letter case), `blob:`/`data:` URLs, relative paths, other hosts, or URLs already containing `/cdn-cgi/image/`.
- Default quality is 75. The only other quality in use is 40. Both must be listed in `images.qualities`.
- Width ladder, and nothing else: `imageSizes` = `96, 256, 480`; `deviceSizes` = `960, 1440, 1920, 2560`. Cloudflare bills per unique width per image, so do not add widths.
- No feature flag and no new environment variables.
- Use the `preload` prop, not `priority` (deprecated in Next 16).
- Sources that cannot be transformed (local `/public` files, SVG icons, Google avatars, `blob:` previews) stay plain `<img>`, or `next/image` with `unoptimized`. A pass-through source on an optimised `Image` logs a dev-only "loader does not implement width" warning; that is expected only for host-supplied URLs that happen to be SVG or AVIF.
- Do not touch `packages/mailing`, `apps/docs`, or the Open Graph image.
- Do not stage or commit the pre-existing uncommitted analytics changes under `apps/business/**/analytics/**` and `apps/business/lib/analytics/**`. Stage files by explicit path.
- Commit messages are plain sentences in the repo's style ("Add the Rooms editor: …") and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NQdXdh9kLnx7zEtTQUJK66
  ```

## Review Focus

1. **A returning visitor has a stored backdrop URL that is no longer in the list** (it will happen when the AVIF backdrops are renamed). Expected: a fresh backdrop is picked, not a broken image. Test in Task 1 (`resolveBackdrop`).
2. **An image URL with unusual shape**: a query string, an uppercase `.AVIF`/`.SVG` extension, or one that is already a `/cdn-cgi/image/` URL. Expected: query string is preserved, the other two pass through untouched and are never double-wrapped. Tests in Task 1.
3. **A host-supplied URL that is not on the CDN**, or an empty string. Expected: returned exactly as given, no exception. Tests in Task 1.
4. **A nonsensical width** (0, negative, `NaN`, fractional). Expected: no malformed `width=` in the URL; bad widths pass the source through, fractions are rounded. Tests in Task 1.
5. **The upload PUT gains a `Cache-Control` header that the R2 bucket's CORS policy may not allow.** Expected: uploads keep working. A blocked upload shows only as `TypeError: Failed to fetch`. Task 9 extends `scripts/check-storage.ts` to preflight the header and must pass before the clients change.

## File Structure

```
packages/images/
  package.json            new workspace package
  tsconfig.json
  src/index.ts            re-exports
  src/cdn.ts              cdnImageUrl, cdnImageSrcSet, isTransformable, size ladders
  src/cdn.test.ts
  src/backdrops.ts        backdrop list + resolveBackdrop (replaces both apps' lib/background.ts)
  src/backdrops.test.ts

apps/web/
  lib/image-loader.ts     next/image loader adapter
  lib/use-backdrop.ts     client hook over resolveBackdrop
  app/p/[hotel_slug]/_components/LocationMap.tsx       the map itself (client)
  app/p/[hotel_slug]/_components/LazyLocationMap.tsx   mounts LocationMap near the viewport

apps/business/
  lib/image-loader.ts
  lib/use-backdrop.ts
  lib/upload-headers.ts   headers a presigned PUT must carry
  lib/upload-headers.test.ts
```

Deleted: `apps/web/lib/background.ts`, `apps/web/lib/backgrounds.json`, `apps/business/lib/background.ts`, `apps/business/lib/backgrounds.json`.

---

### Task 1: The `@openbookings/images` package

**Files:**
- Create: `packages/images/package.json`, `packages/images/tsconfig.json`
- Create: `packages/images/src/index.ts`, `src/cdn.ts`, `src/cdn.test.ts`, `src/backdrops.ts`, `src/backdrops.test.ts`

**Interfaces:**
- Produces:
  - `IMAGE_SIZES: readonly number[]` = `[96, 256, 480]`
  - `DEVICE_SIZES: readonly number[]` = `[960, 1440, 1920, 2560]`
  - `IMAGE_QUALITIES: readonly number[]` = `[40, 75]`
  - `isTransformable(src: string): boolean`
  - `cdnImageUrl(src: string, opts: { width: number; quality?: number }): string`
  - `cdnImageSrcSet(src: string, widths: readonly number[], quality?: number): string | undefined`
  - `type Backdrop = { url: string; name: string }`
  - `BACKDROPS: readonly Backdrop[]`
  - `resolveBackdrop(stored: string | null, random?: () => number): { backdrop: Backdrop; changed: boolean }`

- [ ] **Step 1: Scaffold the package**

`packages/images/package.json`:
```json
{
  "name": "@openbookings/images",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "devDependencies": {
    "@openbookings/config": "workspace:*",
    "@types/bun": "^1.3.14",
    "@types/node": "^22.20.1",
    "typescript": "^5.9.3"
  }
}
```

`packages/images/tsconfig.json`:
```json
{
  "extends": "@openbookings/config/tsconfig.base.json",
  "include": ["src"]
}
```

Run: `bun install` from the repo root. Expected: the lockfile gains `@openbookings/images`.

- [ ] **Step 2: Write the failing tests for the URL builder**

`packages/images/src/cdn.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { cdnImageSrcSet, cdnImageUrl, isTransformable } from "./cdn";

const PHOTO = "https://cdn.openbookings.co/uploads/abc.jpg";
const OPTS = "format=auto,fit=scale-down,onerror=redirect";

describe("cdnImageUrl", () => {
  test("rewrites a CDN photo into a resizing URL", () => {
    expect(cdnImageUrl(PHOTO, { width: 960 })).toBe(
      `https://cdn.openbookings.co/cdn-cgi/image/width=960,quality=75,${OPTS}/uploads/abc.jpg`,
    );
  });

  test("uses the given quality", () => {
    expect(cdnImageUrl(PHOTO, { width: 480, quality: 40 })).toBe(
      `https://cdn.openbookings.co/cdn-cgi/image/width=480,quality=40,${OPTS}/uploads/abc.jpg`,
    );
  });

  test("keeps a query string on the source", () => {
    expect(cdnImageUrl(`${PHOTO}?v=2`, { width: 96 })).toBe(
      `https://cdn.openbookings.co/cdn-cgi/image/width=96,quality=75,${OPTS}/uploads/abc.jpg?v=2`,
    );
  });

  test("rounds a fractional width", () => {
    expect(cdnImageUrl(PHOTO, { width: 255.6 })).toContain("width=256,");
  });

  test.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns the source untouched for width %p",
    (width) => {
      expect(cdnImageUrl(PHOTO, { width })).toBe(PHOTO);
    },
  );

  test.each([
    ["an AVIF source", "https://cdn.openbookings.co/Public/backgrounds/France-Paris.avif"],
    ["an uppercase AVIF extension", "https://cdn.openbookings.co/x/photo.AVIF"],
    ["an SVG source", "https://cdn.openbookings.co/Public/x/logo.svg"],
    ["an SVG with a query string", "https://cdn.openbookings.co/Public/x/logo.SVG?v=1"],
    ["an already transformed URL", `https://cdn.openbookings.co/cdn-cgi/image/width=96,${OPTS}/uploads/abc.jpg`],
    ["another host", "https://lh3.googleusercontent.com/a/abc=s96-c"],
    ["a lookalike host", "https://cdn.openbookings.co.evil.example/uploads/abc.jpg"],
    ["a protocol-relative URL", "//cdn.openbookings.co/uploads/abc.jpg"],
    ["a local public file", "/OB-LOGO-LIGHT.png"],
    ["a blob URL", "blob:https://business.openbookings.co/1b2c"],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["an empty string", ""],
  ])("passes %s through unchanged", (_label, src) => {
    expect(cdnImageUrl(src, { width: 960 })).toBe(src);
    expect(isTransformable(src)).toBe(false);
  });
});

describe("cdnImageSrcSet", () => {
  test("lists one candidate per width", () => {
    expect(cdnImageSrcSet(PHOTO, [960, 1920])).toBe(
      `https://cdn.openbookings.co/cdn-cgi/image/width=960,quality=75,${OPTS}/uploads/abc.jpg 960w, ` +
        `https://cdn.openbookings.co/cdn-cgi/image/width=1920,quality=75,${OPTS}/uploads/abc.jpg 1920w`,
    );
  });

  test("is undefined for a source that cannot be resized, so no srcSet is rendered", () => {
    expect(cdnImageSrcSet("/OB-LOGO-LIGHT.png", [960, 1920])).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/images && bun test src/cdn.test.ts`
Expected: FAIL, cannot find module `./cdn`.

- [ ] **Step 4: Implement the URL builder**

`packages/images/src/cdn.ts`:
```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/images && bun test src/cdn.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Write the failing tests for backdrops**

`packages/images/src/backdrops.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { BACKDROPS, resolveBackdrop } from "./backdrops";

const first = () => 0;

describe("BACKDROPS", () => {
  test("every entry has a name and a CDN url", () => {
    expect(BACKDROPS.length).toBeGreaterThan(0);
    for (const b of BACKDROPS) {
      expect(b.name).not.toBe("");
      expect(b.url.startsWith("https://cdn.openbookings.co/Public/backgrounds/")).toBe(true);
    }
  });
});

describe("resolveBackdrop", () => {
  test("picks one and reports a change when nothing is stored", () => {
    expect(resolveBackdrop(null, first)).toEqual({ backdrop: BACKDROPS[0], changed: true });
  });

  test("keeps a stored backdrop that is still in the list", () => {
    const stored = JSON.stringify(BACKDROPS[1]);
    expect(resolveBackdrop(stored, first)).toEqual({ backdrop: BACKDROPS[1], changed: false });
  });

  test("replaces a stored backdrop whose file has since been renamed", () => {
    const stale = JSON.stringify({ url: "https://cdn.openbookings.co/Public/backgrounds/Gone.avif", name: "Gone" });
    expect(resolveBackdrop(stale, first)).toEqual({ backdrop: BACKDROPS[0], changed: true });
  });

  test.each(["not json", "null", "42", "{}", '{"url":5,"name":"x"}'])(
    "replaces unusable stored value %p",
    (stored) => {
      expect(resolveBackdrop(stored, first)).toEqual({ backdrop: BACKDROPS[0], changed: true });
    },
  );

  test("a random value of just under 1 selects the last entry, not past the end", () => {
    const { backdrop } = resolveBackdrop(null, () => 0.999999);
    expect(backdrop).toEqual(BACKDROPS[BACKDROPS.length - 1]);
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `cd packages/images && bun test src/backdrops.test.ts`
Expected: FAIL, cannot find module `./backdrops`.

- [ ] **Step 8: Implement backdrops**

The 20 entries below are copied from `apps/web/lib/backgrounds.json` (identical in both apps).

`packages/images/src/backdrops.ts`:
```ts
export type Backdrop = { url: string; name: string };

const BASE = "https://cdn.openbookings.co/Public/backgrounds";

// These are AVIF, which Cloudflare cannot resize on this plan, so they are
// served as-is. When JPEG or WebP masters are uploaded, change `file` here
// and nowhere else; `resolveBackdrop` moves returning visitors off the old
// URLs.
const FILES: { name: string; file: string }[] = [
  { name: "Sydney", file: "Australia-Sydney.avif" },
  { name: "Paris", file: "France-Paris.avif" },
  { name: "Honolulu", file: "Hawaii-Honolulu.avif" },
  { name: "Iceland", file: "Iceland-Reykjavik.avif" },
  { name: "Rome", file: "Italy-Rome.avif" },
  { name: "Osaka", file: "Japan-Osaka.avif" },
  { name: "Morroco", file: "Morroco-Chefchaouen.avif" },
  { name: "Amsterdam", file: "Netherlands-Amsterdam.avif" },
  { name: "San Francisco", file: "USA-SanFrancisco.avif" },
  { name: "Rio de Janeiro", file: "Brazil-RioDeJaneiro.avif" },
  { name: "Tuscany", file: "Italy-Tuscany.avif" },
  { name: "Lake Como", file: "Italy-LakeComo.avif" },
  { name: "New York City", file: "USA-NewYorkCity.avif" },
  { name: "Zermatt", file: "Switzerland-Zermatt.avif" },
  { name: "Sa Pa", file: "Vietnam-SaPa.avif" },
  { name: "Scotland", file: "UK-Scotland.avif" },
  { name: "Africa", file: "Africa-Safari.avif" },
  { name: "Iceland", file: "Iceland-Waterfall.avif" },
  { name: "Costa Rica", file: "Costa-Rica-Volcano.avif" },
  { name: "Patagonia", file: "Patagonia-Mountains.avif" },
];

export const BACKDROPS: readonly Backdrop[] = FILES.map(({ name, file }) => ({
  name,
  url: `${BASE}/${file}`,
}));

function pick(random: () => number): Backdrop {
  return BACKDROPS[Math.min(BACKDROPS.length - 1, Math.floor(random() * BACKDROPS.length))];
}

/**
 * The backdrop a visitor should see, given what their browser remembered.
 * `changed` tells the caller to write the result back to storage.
 *
 * A remembered backdrop is only trusted if its URL is still in the list:
 * storage outlives deploys, so a renamed file would otherwise leave returning
 * visitors with a broken image indefinitely.
 */
export function resolveBackdrop(
  stored: string | null,
  random: () => number = Math.random,
): { backdrop: Backdrop; changed: boolean } {
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      const url = typeof parsed === "object" && parsed !== null ? (parsed as { url?: unknown }).url : undefined;
      const known = BACKDROPS.find((b) => b.url === url);
      if (known) return { backdrop: known, changed: false };
    } catch {
      // Unparseable storage is treated the same as none.
    }
  }
  return { backdrop: pick(random), changed: true };
}
```

`packages/images/src/index.ts`:
```ts
export * from "./cdn";
export * from "./backdrops";
```

- [ ] **Step 9: Run all package checks**

Run: `cd packages/images && bun test && bun run typecheck`
Expected: all tests PASS, typecheck exits 0.

- [ ] **Step 10: Commit**

```bash
git add packages/images bun.lock
git commit -m "Add @openbookings/images: Cloudflare resizing URLs and backdrop selection"
```

---

### Task 2: Register the loader in both apps

**Files:**
- Create: `apps/web/lib/image-loader.ts`, `apps/business/lib/image-loader.ts`
- Modify: `apps/web/package.json`, `apps/business/package.json` (dependencies)
- Modify: `apps/web/next.config.ts`, `apps/business/next.config.ts`
- Modify: `apps/business/components/business/Footer.tsx:20`, `apps/business/components/business/FoundersNote.tsx:47`

**Interfaces:**
- Consumes: `cdnImageUrl`, `IMAGE_SIZES`, `DEVICE_SIZES`, `IMAGE_QUALITIES` from `@openbookings/images`.
- Produces: every `next/image` in both apps now routes through `cdnImageUrl`. Later tasks rely on `quality={40}` being an allowed quality.

- [ ] **Step 1: Add the dependency**

In both `apps/web/package.json` and `apps/business/package.json`, add to `dependencies`, keeping alphabetical order (it sits directly before `"@openbookings/maps"`):
```json
"@openbookings/images": "workspace:*",
```
Run: `bun install`

- [ ] **Step 2: Create the loader adapter in each app**

`apps/web/lib/image-loader.ts` and `apps/business/lib/image-loader.ts` (identical content):
```ts
"use client";

import { cdnImageUrl } from "@openbookings/images";

// Registered as `images.loaderFile`, so every `next/image` in this app goes
// through here. Sources Cloudflare cannot resize are returned unchanged.
export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  return cdnImageUrl(src, { width, quality });
}
```

- [ ] **Step 3: Configure `next.config.ts` in each app**

In both files add the import below the existing imports:
```ts
import { DEVICE_SIZES, IMAGE_QUALITIES, IMAGE_SIZES } from "@openbookings/images";
```

In `apps/web/next.config.ts` change `transpilePackages` to:
```ts
  transpilePackages: ["@openbookings/analytics", "@openbookings/images", "@openbookings/maps"],
```
In `apps/business/next.config.ts` change it to:
```ts
  transpilePackages: ["@openbookings/analytics", "@openbookings/images", "@openbookings/maps", "@openbookings/messaging"],
```

In both, add directly after the `outputFileTracingRoot` line:
```ts
  // Resizing is done by Cloudflare on cdn.openbookings.co, not by this
  // server. The size lists are deliberately short: each width is a separately
  // billed transformation per image.
  images: {
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
    imageSizes: [...IMAGE_SIZES],
    deviceSizes: [...DEVICE_SIZES],
    qualities: [...IMAGE_QUALITIES],
  },
```

- [ ] **Step 4: Mark the two existing local images as unoptimised**

A custom loader cannot resize `/public` files, and passing them through would log a dev warning. In `apps/business/components/business/Footer.tsx` line 20:
```tsx
<Image src="/OB-LOGO-LIGHT.png" alt="OpenBookings Business" width={100} height={75} unoptimized />
```
(The file is 4:3, so the old `height={100}` was wrong; 75 keeps the same rendered width.)

In `apps/business/components/business/FoundersNote.tsx`, add `unoptimized` to the existing `<Image src="/founder.png" …>` after the `height={176}` line.

- [ ] **Step 5: Verify both apps build**

Run: `bunx turbo run typecheck build --filter=@openbookings/web --filter=@openbookings/business`
Expected: both succeed. If the build reports that the `ts` loader file cannot be resolved, change `loaderFile` to a path Next accepts (the docs example uses a `.js` file) and keep the content identical.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/image-loader.ts apps/business/lib/image-loader.ts \
  apps/web/package.json apps/business/package.json bun.lock \
  apps/web/next.config.ts apps/business/next.config.ts \
  apps/business/components/business/Footer.tsx apps/business/components/business/FoundersNote.tsx
git commit -m "Route next/image through Cloudflare image resizing in web and business"
```

---

### Task 3: Hotel page images

**Files (all under `apps/web/app/p/[hotel_slug]/_components/`):**
- Modify: `HeroSection.tsx:6-9`, `GalleryBar.tsx` (strip tile ~line 170, dialog image ~line 70), `RoomsCarousel.tsx:~298-306`, `FootnoteSection.tsx:10-25`, `PoliciesSection.tsx:142`

**Interfaces:**
- Consumes: the global loader from Task 2; `cdnImageUrl`, `cdnImageSrcSet` from `@openbookings/images`.

- [ ] **Step 1: Hero — CSS background to a preloaded image**

In `HeroSection.tsx` add `import Image from "next/image";` and replace the background `div` (the one with `style={{ backgroundImage: … }}`) and its child gradient with:
```tsx
      <div className="absolute inset-0">
        {hotel.hero_image_url && (
          <Image
            src={hotel.hero_image_url}
            alt=""
            fill
            preload
            sizes="100vw"
            className="object-cover object-center"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 20%, rgba(0,0,0,0.2) 45%, rgba(0,0,0,0) 65%, rgba(0,0,0,0.3) 100%)",
          }}
        />
      </div>
```
`alt=""` because the `<h1>` beside it already names the property and the old background had no text alternative.

- [ ] **Step 2: Gallery strip tiles**

In `GalleryBar.tsx` add `import Image from "next/image";` and replace the tile `<img>` with:
```tsx
              <Image
                src={img.url}
                alt={img.alt_text ?? `Property image ${(i % images.length) + 1}`}
                fill
                sizes="195px"
                className="object-cover"
                draggable={false}
              />
```
The parent `div` is already `relative` with a fixed width and the strip has a fixed height of 130, so `fill` has a box to fill. Leave the 4× `repeated` array alone.

- [ ] **Step 3: Gallery dialog**

The dialog image stays a `motion.img` (it animates and is `object-contain` with no fixed box). Add:
```ts
import { cdnImageSrcSet, cdnImageUrl } from "@openbookings/images";
```
and on the `motion.img` replace `src={url}` with:
```tsx
              src={cdnImageUrl(url, { width: 1920 })}
              srcSet={cdnImageSrcSet(url, [960, 1440, 1920, 2560])}
              sizes="100vw"
              decoding="async"
```

- [ ] **Step 4: Room carousel**

In `RoomsCarousel.tsx` add `import Image from "next/image";` and replace the inner `motion.div` that carries `backgroundImage` with:
```tsx
                <motion.div
                  key={imageIndex}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.55 }}
                  className="absolute inset-0"
                >
                  {room.images[imageIndex] && (
                    <Image
                      src={room.images[imageIndex]}
                      alt=""
                      fill
                      sizes="(min-width: 1152px) 1056px, 100vw"
                      className="object-cover object-center"
                      draggable={false}
                    />
                  )}
                </motion.div>
```
The stage is capped by `max-w-6xl` (1152px) minus its horizontal padding, hence 1056px. `draggable={false}` matters: the parent handles drag-to-swipe and a draggable image would start a native image drag instead.

- [ ] **Step 5: Footnote logos and payment artwork**

In `FootnoteSection.tsx` add `import Image from "next/image";`. Replace the host logo `<img>` with:
```tsx
            <Image
              src={hotel.logo_image_url}
              alt={`${hotel.name} logo`}
              width={112}
              height={112}
              className="h-auto w-28 object-contain"
            />
```
and the platform logo `<img>` with:
```tsx
          <Image
            src="https://cdn.openbookings.co/Public/Openbookings-logo-v2.png"
            alt="OpenBookings"
            width={112}
            height={84}
            className="h-auto w-28 object-contain"
          />
```
In `PoliciesSection.tsx` the payment artwork comes from Stripe's hosts, which the loader does not transform. Keep it an `<img>` and add `loading="lazy" decoding="async"`:
```tsx
                    <img src={artwork_url} alt={label} className="h-5 w-10 object-contain" draggable={false} loading="lazy" decoding="async" />
```

- [ ] **Step 6: Verify**

Run: `bunx turbo run typecheck lint --filter=@openbookings/web`
Expected: PASS with no new warnings in these five files.

Then run `bun run dev --filter=@openbookings/web`, open a hotel page (`/p/<slug>` for a property in the dev database) and confirm in the browser's network panel:
- the hero is requested from `/cdn-cgi/image/width=…` and a `<link rel="preload" as="image">` for it is in the document head;
- gallery tiles request `width=256` or `width=480`, not the originals;
- room images are not requested until the rooms section scrolls near;
- dragging the room carousel still swipes.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/p/[hotel_slug]/_components/HeroSection.tsx" \
  "apps/web/app/p/[hotel_slug]/_components/GalleryBar.tsx" \
  "apps/web/app/p/[hotel_slug]/_components/RoomsCarousel.tsx" \
  "apps/web/app/p/[hotel_slug]/_components/FootnoteSection.tsx" \
  "apps/web/app/p/[hotel_slug]/_components/PoliciesSection.tsx"
git commit -m "Serve hotel page images resized, with the hero preloaded and the rest lazy"
```

---

### Task 4: Backdrops (home, search, checkout, business login)

**Files:**
- Create: `apps/web/lib/use-backdrop.ts`, `apps/business/lib/use-backdrop.ts`
- Modify: `apps/web/app/page.tsx` (state at ~34-38, effect at ~66-111, markup at ~116-132, heading at ~140)
- Modify: `apps/web/app/search/page.tsx` (state at ~77, effect at ~148-187, markup at ~210-221)
- Modify: `apps/web/app/checkout/_components/Backdrop.tsx`
- Modify: `apps/business/app/(auth)/login/login-client.tsx` (effect at ~33-72, markup at ~76-81)
- Delete: `apps/web/lib/background.ts`, `apps/web/lib/backgrounds.json`, `apps/business/lib/background.ts`, `apps/business/lib/backgrounds.json`

**Interfaces:**
- Consumes: `resolveBackdrop`, `type Backdrop` from `@openbookings/images`.
- Produces: `useBackdrop(): Backdrop | null` in each app (null until the browser has chosen one).

- [ ] **Step 1: Create the hook in both apps**

`apps/web/lib/use-backdrop.ts` and `apps/business/lib/use-backdrop.ts` (identical):
```ts
"use client";

import { useEffect, useState } from "react";
import { resolveBackdrop, type Backdrop } from "@openbookings/images";

const STORAGE_KEY = "ob_backgrounds";
// Earlier versions copied each backdrop into the Cache API and rendered a
// blob URL. The HTTP cache already does that job, so the copies are dropped.
const LEGACY_CACHES = ["ob_backgrounds", "openbookings-backgrounds"];

/**
 * The visitor's backdrop, chosen once and remembered. Null on the server and
 * on first render, because the choice is random and must not differ between
 * the server's HTML and the browser's.
 */
export function useBackdrop(): Backdrop | null {
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);

  useEffect(() => {
    function load() {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch {
        // Storage blocked: fall through and pick without remembering.
      }
      const resolved = resolveBackdrop(stored);
      if (resolved.changed) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(resolved.backdrop));
        } catch {
          // Not remembered; a different backdrop next visit is harmless.
        }
      }
      setBackdrop(resolved.backdrop);

      if (typeof caches !== "undefined") {
        for (const name of LEGACY_CACHES) void caches.delete(name).catch(() => {});
      }
    }
    load();
  }, []);

  return backdrop;
}
```

- [ ] **Step 2: Home page**

In `apps/web/app/page.tsx`:
- Replace `import { getRandomBackgroundImage } from "@/lib/background";` with
  `import Image from "next/image";` and `import { useBackdrop } from "@/lib/use-backdrop";`.
- Delete the `backgroundImage` and `backgroundSrc` `useState` declarations and the whole `useEffect` that defines `loadBackground` (including its two-line comment).
- Add near the other hooks: `const backdrop = useBackdrop();`
- Replace the background `div` (the one with `style={{ backgroundImage: … }}`), keeping its gradient child, with:
```tsx
        <div className="fixed inset-0 bg-black">
          {backdrop && (
            <Image
              src={backdrop.url}
              alt=""
              fill
              sizes="100vw"
              loading="eager"
              fetchPriority="high"
              className="object-cover object-center"
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0) 100%)",
            }}
          ></div>
        </div>
```
- Change the heading to `Discover {backdrop?.name || ""}`.

`preload` is not used here: the image is chosen after hydration, so a preload link would arrive too late to help. `fetchPriority="high"` is what moves it ahead of other requests.

- [ ] **Step 3: Search page**

In `apps/web/app/search/page.tsx`:
- Replace the `getRandomBackgroundImage` import with `import Image from "next/image";` and `import { useBackdrop } from "@/lib/use-backdrop";`.
- Delete the `backgroundSrc` `useState` and the whole `useEffect` that defines `loadBackground`.
- Add `const backdrop = useBackdrop();`
- Replace the background layer with:
```tsx
      <div className="fixed inset-0 bg-black">
        {backdrop && (
          // Deliberately low resolution: it sits under a blur and a 70% black
          // layer, so a quarter-width, low-quality image is indistinguishable.
          <Image
            src={backdrop.url}
            alt=""
            fill
            sizes="25vw"
            quality={40}
            className="object-cover object-center"
          />
        )}
        <div
          className="absolute inset-0 backdrop-blur-md"
          style={{ background: "rgba(0,0,0,0.7)" }}
        />
      </div>
```

- [ ] **Step 4: Checkout backdrop**

Replace the body of `Backdrop` in `apps/web/app/checkout/_components/Backdrop.tsx` (keep the doc comment above the function) with:
```tsx
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
```
Add `import Image from "next/image";` at the top. The old "Not next/image" comment and its eslint-disable line go away.

- [ ] **Step 5: Business login**

In `apps/business/app/(auth)/login/login-client.tsx`:
- Replace the `getRandomBackgroundImage` import with `import Image from "next/image";` and `import { useBackdrop } from "@/lib/use-backdrop";`.
- Delete the `backgroundSrc` state and the `useEffect` that defines `loadBackground`.
- Add `const backdrop = useBackdrop();`
- Replace the background `div` with:
```tsx
      <div className="absolute inset-0 bg-black z-0">
        {backdrop && (
          <Image
            src={backdrop.url}
            alt=""
            fill
            sizes="100vw"
            loading="eager"
            fetchPriority="high"
            className="object-cover object-center"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0) 100%)",
          }}
        />
      </div>
```

- [ ] **Step 6: Delete the old backdrop modules**

```bash
git rm apps/web/lib/background.ts apps/web/lib/backgrounds.json apps/business/lib/background.ts apps/business/lib/backgrounds.json
grep -rn "lib/background\|backgrounds.json\|getRandomBackgroundImage" apps --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next
```
Expected: the grep prints nothing.

- [ ] **Step 7: Verify**

Run: `bunx turbo run typecheck lint --filter=@openbookings/web --filter=@openbookings/business`
Expected: PASS. If lint flags unused imports (`useState`, `useEffect`) in the edited pages, remove only the ones that are now unused.

In the browser on `/`, `/search` and the business `/login`: a backdrop appears, the home heading names it, reloading keeps the same one, and DevTools → Application → Cache Storage no longer lists `ob_backgrounds`. While the backdrops are still AVIF the console shows a dev-only "does not implement width" warning for them; that is expected and disappears when the masters are replaced.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/use-backdrop.ts apps/business/lib/use-backdrop.ts apps/web/app/page.tsx \
  apps/web/app/search/page.tsx apps/web/app/checkout/_components/Backdrop.tsx \
  "apps/business/app/(auth)/login/login-client.tsx"
git commit -m "Render backdrops as prioritised images and drop the Cache API copy"
```

---

### Task 5: Guest app cards, thumbnails and logos

**Files (under `apps/web/`):**
- Modify: `components/search/HotelCard.tsx` (image at ~78-84, props of `HotelCardHeroImage` and `HotelCard`)
- Modify: `app/search/page.tsx:~295-297`
- Modify: `app/checkout/_components/TripSummary.tsx:85-106`, `CheckoutGate.tsx:~206-212`
- Modify: `components/nav.tsx:~76-84`, `components/legal/LegalDocument.tsx:~73-78`, `components/auth/SS-AuthForm.tsx:22`

**Interfaces:**
- Produces: `HotelCard` gains an optional prop `eager?: boolean` (default `false`).

The platform logo `https://cdn.openbookings.co/Public/Openbookings-logo-v2.png` is 4:3. Wherever it is converted, `width` and `height` are the largest size it renders at, and the existing `h-* w-auto` classes keep controlling the displayed size.

- [ ] **Step 1: Search cards**

In `HotelCard.tsx` add `import Image from "next/image";`. Give `HotelCardHeroImage` an `eager: boolean` prop and replace its `<img>` with:
```tsx
        <Image
          src={currentSrc}
          alt={hotelName}
          fill
          sizes="(min-width: 1024px) 320px, (min-width: 768px) 50vw, 100vw"
          loading={eager ? "eager" : "lazy"}
          draggable={false}
          className="object-cover object-[center_15%] transition-transform duration-600 ease-out group-hover:scale-105"
        />
```
Render it only when `currentSrc` is truthy (wrap in `{currentSrc ? … : null}`): `buildHotelImageUrl` returns `""` for a missing image and `next/image` throws on an empty `src`.

Add `eager = false` to `HotelCard`'s props (`{ hotel, eager = false }: { hotel: HotelCardData; eager?: boolean }`) and pass `eager={eager}` to `HotelCardHeroImage`.

In `app/search/page.tsx` change the map to:
```tsx
              {sortedHotels.map((hotel, index) => (
                // The first row is above the fold at every breakpoint.
                <HotelCard key={hotel.id} hotel={hotel} eager={index < 3} />
              ))}
```

- [ ] **Step 2: Checkout thumbnails and logos**

In `TripSummary.tsx` add `import Image from "next/image";` and replace the three `<img>` elements (drop their eslint-disable comments):
```tsx
        {logoUrl && (
          <Image src={logoUrl} alt={propertyName} width={128} height={48} className="h-10 w-auto sm:h-12 object-contain" />
        )}
```
```tsx
        <Image
          src="/OB-LOGO-LIGHT.png"
          alt="OpenBookings"
          width={64}
          height={48}
          unoptimized
          className="h-10 w-auto sm:h-12 object-contain"
        />
```
```tsx
          <Image
            src={roomImageUrl}
            alt=""
            width={224}
            height={126}
            className="aspect-16/9 w-40 shrink-0 rounded-2xl object-cover ring-1 ring-white/15 sm:w-56"
          />
```
In `CheckoutGate.tsx` add the import and replace the logo `<img>` (and its eslint-disable comment) with:
```tsx
          <Image
            src="https://cdn.openbookings.co/Public/Openbookings-logo-v2.png"
            alt="OpenBookings"
            width={43}
            height={32}
            className="pointer-events-none mx-auto h-8 w-auto select-none"
            draggable={false}
          />
```

- [ ] **Step 3: Nav, legal and auth logos**

In each file add `import Image from "next/image";` and replace the platform-logo `<img>` only, keeping every existing `className`, `style` and `draggable` value:

`components/nav.tsx` (the logo, not the profile avatar): `width={86} height={64}`, and add `preload` — the nav logo is on screen at first paint on every guest page.

`components/legal/LegalDocument.tsx`: `width={43} height={32}`.

`components/auth/SS-AuthForm.tsx`: `width={86} height={64}`.

Leave these as plain `<img>`: the profile avatar in `nav.tsx`, the Apple/Google icons in `AuthFormFields.tsx`, and `powered-by-stripe.svg` in `PaymentCard.tsx`. They are small local files the loader cannot resize.

- [ ] **Step 4: Verify**

Run: `bunx turbo run typecheck lint --filter=@openbookings/web`
Expected: PASS.

In the browser: on `/search` with results, the first three cards' images load immediately and later rows load on scroll; the photo arrows on a card still cycle images; the nav logo is requested at `width=96` or `width=256`, not as the 629 KB original.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/search/HotelCard.tsx apps/web/app/search/page.tsx \
  apps/web/app/checkout/_components/TripSummary.tsx apps/web/app/checkout/_components/CheckoutGate.tsx \
  apps/web/components/nav.tsx apps/web/components/legal/LegalDocument.tsx apps/web/components/auth/SS-AuthForm.tsx
git commit -m "Resize search cards, checkout thumbnails and logos in the guest app"
```

---

### Task 6: Load the hotel page map on demand

**Files (under `apps/web/app/p/[hotel_slug]/_components/`):**
- Create: `LocationMap.tsx`, `LazyLocationMap.tsx`
- Modify: `LocationSection.tsx:1-3` and `:42-63`

**Interfaces:**
- Produces: `LocationMap({ lon, lat }: { lon: number; lat: number })`, `LazyLocationMap` with the same props.

- [ ] **Step 1: Move the map into its own client component**

`LocationMap.tsx`:
```tsx
"use client";

import { Map, MapMarker, MarkerContent } from "@/components/ui/map";

export function LocationMap({ lon, lat }: { lon: number; lat: number }) {
  return (
    <Map center={[lon, lat]} zoom={14} interactive={false}>
      <MapMarker longitude={lon} latitude={lat}>
        <MarkerContent>
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 24 30" fill="none">
            <path
              d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 21 9 21s9-14.25 9-21c0-4.97-4.03-9-9-9z"
              fill="oklch(62% 0.21 268)"
            />
            <circle cx="12" cy="9" r="3.5" fill="white" />
          </svg>
        </MarkerContent>
      </MapMarker>
    </Map>
  );
}
```

- [ ] **Step 2: Add the on-demand wrapper**

`LazyLocationMap.tsx`:
```tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// maplibre-gl is several hundred kilobytes and the map is the last section on
// the page, so neither the code nor the tiles are fetched until a guest
// scrolls to within a viewport of it.
const LocationMap = dynamic(() => import("./LocationMap").then((m) => m.LocationMap), { ssr: false });

export function LazyLocationMap({ lon, lat }: { lon: number; lat: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="size-full bg-white/4">
      {near && <LocationMap lon={lon} lat={lat} />}
    </div>
  );
}
```
If lint rejects the synchronous `setNear(true)` in the effect (`react-hooks/set-state-in-effect`), initialise the state lazily instead: `useState(() => typeof window !== "undefined" && typeof IntersectionObserver === "undefined")` and drop that branch.

- [ ] **Step 3: Use it in the section**

In `LocationSection.tsx` replace the `Map, MapMarker, MarkerContent` import with:
```ts
import { LazyLocationMap } from "./LazyLocationMap";
```
and replace the `<Map>…</Map>` block inside the `pointer-events-none` wrapper with:
```tsx
                <LazyLocationMap lon={hotel.lon} lat={hotel.lat} />
```
`hasCoords` already guarantees both are numbers; if TypeScript does not narrow them, pass `hotel.lon as number` and `hotel.lat as number` inside that guarded block.

- [ ] **Step 4: Verify**

Run: `bunx turbo run typecheck lint build --filter=@openbookings/web`
Expected: PASS.

In the browser on a hotel page with coordinates: with the network panel filtered to JS, no chunk containing `maplibre` loads at the top of the page; it loads when scrolling towards "Location", and the map then renders with its pin. The container keeps its size before and after (no layout shift).

`apps/web/components/GeneralMap.tsx` is imported nowhere. Leave it and mention it in the final report.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/p/[hotel_slug]/_components/LocationMap.tsx" \
  "apps/web/app/p/[hotel_slug]/_components/LazyLocationMap.tsx" \
  "apps/web/app/p/[hotel_slug]/_components/LocationSection.tsx"
git commit -m "Load the hotel page map only when the guest scrolls near it"
```

---

### Task 7: Business app images

**Files (under `apps/business/`):**
- Modify: `app/(dashboard)/dashboard/listings/rooms/_components/rooms-index.tsx:~190-192`
- Modify: `app/(dashboard)/dashboard/listings/_components/image-manager.tsx:~232-243` and `:~310-311`
- Modify: `components/upload/RoomImageUploader.tsx:~116-123`
- Modify: `components/dashboard/sidebar-08/sidebar-brand.tsx` (two `<img>`)
- Modify: `components/dashboard/messages/messages-list.tsx:~42-43`
- Modify: `app/(onboarding)/layout.tsx:~20-25`, `components/AuthLoadingScreen.tsx:~20-26`, `components/auth/SS-AuthForm.tsx:22`, `components/business/Nav.tsx:59`

Leave as plain `<img>`: upload previews (`image-manager.tsx:~373`, `core-info-text.tsx:162`), which are `blob:` URLs, and the provider icons in `AuthFormFields.tsx`.

- [ ] **Step 1: Thumbnails that have a sized box — use `fill`**

`rooms-index.tsx`: the wrapping `span` needs `relative` added to its class list. Replace the `<img>` and its eslint-disable comment with:
```tsx
                        <Image src={room.coverUrl} alt="" fill sizes="48px" className="object-cover" />
```

`image-manager.tsx` single slot (~line 232): the wrapping `div` is already `relative`. Replace the `<img>` and its eslint-disable comment with:
```tsx
            <Image
              src={src}
              alt=""
              fill
              sizes="(min-width: 768px) 448px, 100vw"
              className={cn(
                single.aspect === "wide" ? "object-cover" : "object-contain p-3",
                busy && "opacity-60",
              )}
            />
```
`src` here can be a `blob:` preview while an upload is in flight. The loader passes those through; add `unoptimized={src.startsWith("blob:")}` so no srcset is built for them.

`RoomImageUploader.tsx` confirmed images: wrap each in a sized box.
```tsx
          {confirmedImages.map((img) => (
            <div key={img.id} className="relative aspect-square w-full overflow-hidden rounded-md">
              <Image src={img.url} alt="" fill sizes="(min-width: 768px) 200px, 33vw" className="object-cover" />
            </div>
          ))}
```
Add `import Image from "next/image";` to each of the three files.

- [ ] **Step 2: The image-manager gallery — keep `<img>`, add a srcSet**

`AttachmentMedia` styles its child `img` directly, so `next/image` wrappers are not used here. At ~line 311:
```tsx
              <img
                src={cdnImageUrl(image.url, { width: 256 })}
                srcSet={cdnImageSrcSet(image.url, [256, 480])}
                sizes="160px"
                alt={image.altText ?? ""}
                loading="lazy"
                decoding="async"
              />
```
with `import { cdnImageSrcSet, cdnImageUrl } from "@openbookings/images";`. Keep the existing eslint-disable comment above it.

- [ ] **Step 3: Logos**

Add `import Image from "next/image";` and convert, keeping every existing `className`, comment, `style`, `draggable` and `onError`:

- `sidebar-brand.tsx`, platform mark: `<Image src={OPENBOOKINGS_MARK} alt="" width={43} height={32} … />`.
- `sidebar-brand.tsx`, property logo: `<Image src={logoUrl as string} alt={brand?.name ?? ""} width={128} height={32} onError={() => setLogoFailed(true)} … />`.
- `app/(onboarding)/layout.tsx`: `width={43} height={32}`.
- `components/AuthLoadingScreen.tsx`: `width={107} height={80}`, plus `preload` (it is the only thing on screen while it shows).
- `components/auth/SS-AuthForm.tsx`: `width={86} height={64}`.
- `components/business/Nav.tsx`: `<Image src="/OB-LIGHT-WORDMARK.png" alt="OpenBookings Business" width={200} height={40} unoptimized className="h-10 w-auto" />` (the file is 10300×2064, about 5:1; `Image` is already imported in this file).

- [ ] **Step 4: Guest avatars**

`thread.guest_image` is usually a Google avatar, which the loader does not transform. In `messages-list.tsx` keep the `<img>` and add `loading="lazy" decoding="async"`.

- [ ] **Step 5: Verify**

Run: `bunx turbo run typecheck lint --filter=@openbookings/business`
Expected: PASS for the files above. (Lint may report on the pre-existing uncommitted analytics files; that is not part of this work.)

In the browser, signed in to the dashboard: room covers in Listings → Rooms request `width=96`; the photo manager shows thumbnails at `width=256`/`480`; uploading a photo still shows its preview, then the stored image; the sidebar shows the mark, and a property with a broken logo URL still falls back as before.

- [ ] **Step 6: Commit**

```bash
git add "apps/business/app/(dashboard)/dashboard/listings/rooms/_components/rooms-index.tsx" \
  "apps/business/app/(dashboard)/dashboard/listings/_components/image-manager.tsx" \
  apps/business/components/upload/RoomImageUploader.tsx \
  apps/business/components/dashboard/sidebar-08/sidebar-brand.tsx \
  apps/business/components/dashboard/messages/messages-list.tsx \
  "apps/business/app/(onboarding)/layout.tsx" apps/business/components/AuthLoadingScreen.tsx \
  apps/business/components/auth/SS-AuthForm.tsx apps/business/components/business/Nav.tsx
git commit -m "Resize and lazy-load images across the business dashboard"
```

---

### Task 8: Load the business map editors on demand

**Files (under `apps/business/app/`):**
- Modify: `(dashboard)/dashboard/listings/property/_components/property-editor.tsx:22`
- Modify: `(onboarding)/onboarding/address/client.tsx:5`

- [ ] **Step 1: Property editor**

In `property-editor.tsx` replace `import { LocationSection } from "./sections/location";` with:
```tsx
import dynamic from "next/dynamic";

// The location section pulls in maplibre-gl, which no other section needs.
const LocationSection = dynamic(() => import("./sections/location").then((m) => m.LocationSection), {
  ssr: false,
  loading: () => <div className="h-96 animate-pulse rounded-xl bg-muted" aria-hidden />,
});
```
(Merge the `dynamic` import with the file's existing imports; `property-editor.tsx` must already be a client component for `ssr: false` to be allowed. If it is a server component, put these lines in a new `sections/lazy-location.tsx` that starts with `"use client"` and exports `LocationSection`, and import from there.)

- [ ] **Step 2: Onboarding address step**

In `address/client.tsx` replace line 5 with:
```tsx
import dynamic from "next/dynamic";
import type { CoreInfoLocationValues } from "../_steps/core-info-location";

const CoreInfoLocationStep = dynamic(
  () => import("../_steps/core-info-location").then((m) => m.CoreInfoLocationStep),
  { ssr: false, loading: () => <div className="h-96 animate-pulse rounded-xl bg-white/5" aria-hidden /> },
);
```

- [ ] **Step 3: Verify**

Run: `bunx turbo run typecheck lint build --filter=@openbookings/business`
Expected: PASS.

In the browser: Listings → Property shows a brief placeholder where the location section is, then the section with a working map (click to place the pin, save). Onboarding → Address behaves the same: search an address, the map recentres, continue saves it. If the placeholder height causes a visible jump, set it to the rendered section's height.

- [ ] **Step 4: Commit**

```bash
git add "apps/business/app/(dashboard)/dashboard/listings/property/_components/property-editor.tsx" \
  "apps/business/app/(onboarding)/onboarding/address/client.tsx"
git commit -m "Split maplibre out of the property editor and onboarding bundles"
```

---

### Task 9: Cache headers on new uploads

**Files (under `apps/business/`):**
- Create: `lib/upload-headers.ts`, `lib/upload-headers.test.ts`
- Modify: `scripts/check-storage.ts:~115` and `:~142`
- Modify: `app/api/upload/presign/route.ts:~43-51`
- Modify: `app/(dashboard)/dashboard/listings/_components/image-manager.tsx:~118-124`
- Modify: `components/upload/RoomImageUploader.tsx:~24-58`

**Interfaces:**
- Produces: `UPLOAD_CACHE_CONTROL: string`, `uploadHeaders(contentType: string): Record<string, string>`. The presign response gains `headers: Record<string, string>`.

Background: both headers are part of the presigned signature, so the browser's PUT must send exactly these values or R2 rejects it. And because the PUT is cross-origin, the bucket's CORS policy must allow each header name.

- [ ] **Step 1: Write the failing test**

`apps/business/lib/upload-headers.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { UPLOAD_CACHE_CONTROL, uploadHeaders } from "./upload-headers";

describe("uploadHeaders", () => {
  test("carries the content type and a one-year immutable cache policy", () => {
    expect(uploadHeaders("image/webp")).toEqual({
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  test("the cache policy is the exported constant, so the signature and the PUT cannot drift", () => {
    expect(uploadHeaders("image/png")["Cache-Control"]).toBe(UPLOAD_CACHE_CONTROL);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/business && bun test lib/upload-headers.test.ts`
Expected: FAIL, cannot find module `./upload-headers`.

- [ ] **Step 3: Implement**

`apps/business/lib/upload-headers.ts`:
```ts
/**
 * Upload keys are random UUIDs, so the bytes at a URL never change and can be
 * cached for as long as HTTP allows.
 */
export const UPLOAD_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * The headers a presigned upload PUT must send. Both are signed into the URL,
 * so the browser has to send these exact values or R2 rejects the signature.
 */
export function uploadHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": UPLOAD_CACHE_CONTROL,
  };
}
```

Run: `cd apps/business && bun test lib/upload-headers.test.ts`
Expected: PASS.

- [ ] **Step 4: Extend the storage check and run it — gate for the rest of this task**

In `scripts/check-storage.ts`, change the preflight's requested headers (~line 115) to:
```ts
      "Access-Control-Request-Headers": "content-type,cache-control",
```
and add the header to the real PUT (~line 142):
```ts
  headers: { Origin: appOrigin, "Content-Type": "image/png", "Cache-Control": UPLOAD_CACHE_CONTROL },
```
importing `UPLOAD_CACHE_CONTROL` from `../lib/upload-headers`. Where the script builds its `PutObjectCommand` for that presigned PUT, add `CacheControl: UPLOAD_CACHE_CONTROL` so the signature matches.

Run: `cd apps/business && bun scripts/check-storage.ts` (needs the R2 variables from the app's env file).

- If it prints `✓ CORS preflight OK`, continue.
- If it prints `✗ CORS rejects …`, **stop this task here**, commit Steps 1-4 only, and report: the bucket's CORS policy must list `cache-control` under allowed headers (R2 dashboard → bucket → Settings → CORS policy). Do not change the route or the clients until the check passes; doing so would break every upload with a bare `Failed to fetch`.
- If the script cannot run because the R2 variables are not available, treat it the same as a failure: stop and report.

- [ ] **Step 5: Sign the header in the presign route**

In `app/api/upload/presign/route.ts` add `import { UPLOAD_CACHE_CONTROL, uploadHeaders } from "@/lib/upload-headers";` and replace from the `// ContentType is signed in` comment to the end of the handler with:
```ts
  // ContentType and CacheControl are signed in, so the browser's PUT must send
  // the same two headers or R2 rejects the signature. They are returned to the
  // client rather than rebuilt there, so the two sides cannot drift.
  const uploadUrl = await getSignedUrl(
    getS3(),
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      ContentType: contentType,
      CacheControl: UPLOAD_CACHE_CONTROL,
    }),
    { expiresIn: 600 },
  );

  return NextResponse.json({ uploadUrl, key, headers: uploadHeaders(contentType) });
}
```

- [ ] **Step 6: Send the returned headers from both clients**

`image-manager.tsx`:
```ts
      const { uploadUrl, key: storageKey, headers } = await presign.json();

      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        body: file,
      });
```

`RoomImageUploader.tsx`: add `headers?: Record<string, string>` to the `Meta` type, then in `endpoint`:
```ts
      const { uploadUrl, key, headers } = (await res.json()) as {
        uploadUrl: string;
        key: string;
        headers: Record<string, string>;
      };
      uppy.setFileMeta(file.id, { key, roomId, headers });
      return uploadUrl;
```
and replace the `headers` option with:
```ts
    headers: (file: UppyFile<Meta, Body>) =>
      file.meta.headers ?? { "Content-Type": file.type ?? "image/jpeg" },
```
If Uppy resolves `headers` before `endpoint` for a file (so `file.meta.headers` is still undefined when read), the PUT will be rejected with a 403 signature error in Step 7. In that case fetch the presign in an `uppy.addPreProcessor` instead, storing `uploadUrl`, `key` and `headers` in the file's meta, and have `endpoint` return `file.meta.uploadUrl`.

- [ ] **Step 7: Verify end to end**

Run: `bunx turbo run typecheck lint test --filter=@openbookings/business`
Expected: PASS.

In the browser, upload one photo through Listings → Property photos and one through the room uploader. Both must complete. Then, with the uploaded URL:
```bash
curl -sI "<the new image url>" | grep -i cache-control
```
Expected: a `cache-control` header with `max-age=31536000` (the Cloudflare Cache Rule may rewrite the exact value; a one-year `max-age` is what matters).

- [ ] **Step 8: Commit**

```bash
git add apps/business/lib/upload-headers.ts apps/business/lib/upload-headers.test.ts \
  apps/business/scripts/check-storage.ts apps/business/app/api/upload/presign/route.ts \
  "apps/business/app/(dashboard)/dashboard/listings/_components/image-manager.tsx" \
  apps/business/components/upload/RoomImageUploader.tsx
git commit -m "Store new uploads with a one-year immutable cache policy"
```

---

### Task 10: Shrink the static assets

**Files:**
- Modify (binary, in place): `apps/business/public/founder.png`, `apps/business/public/OB-LIGHT-WORDMARK.png`, `apps/business/public/OB-LOGO-LIGHT.png`, `apps/web/public/OB-LOGO-LIGHT.png`, `apps/web/public/profile_avatar.png`, `apps/business/public/profile_avatar.png`, `apps/web/public/Openbookings-logo-v2.svg`, `apps/business/public/Openbookings-logo-v2.svg`

Target widths are at least twice the largest rendered size:

| File | Now | Rendered at most | Target width |
|---|---|---|---|
| `founder.png` | 1024×1024, 1.8 MB | 176px | 352 |
| `OB-LIGHT-WORDMARK.png` | 10300×2064, 1.2 MB | 200×40 | 600 |
| `OB-LOGO-LIGHT.png` (×2) | 2752×2064, 629 KB | 100px wide | 256 |
| `profile_avatar.png` (×2) | 499×500, 42 KB | 56px | 128 |

- [ ] **Step 1: Resize the PNGs with a throwaway script outside the repo**

```bash
REPO="$(git rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
cd "$WORK" && bun init -y >/dev/null && bun add sharp svgo
cat > shrink.mjs <<'EOF'
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

const repo = process.argv[2];
const jobs = [
  ["apps/business/public/founder.png", 352],
  ["apps/business/public/OB-LIGHT-WORDMARK.png", 600],
  ["apps/business/public/OB-LOGO-LIGHT.png", 256],
  ["apps/web/public/OB-LOGO-LIGHT.png", 256],
  ["apps/web/public/profile_avatar.png", 128],
  ["apps/business/public/profile_avatar.png", 128],
];
for (const [file, width] of jobs) {
  const path = `${repo}/${file}`;
  const input = await readFile(path);
  const output = await sharp(input).resize({ width }).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path, output);
  console.log(`${file}: ${input.length} -> ${output.length} bytes`);
}
EOF
bun shrink.mjs "$REPO"
```
Expected: every line shows a smaller size; the two largest drop below 150 KB.

- [ ] **Step 2: Optimise the SVG**

```bash
cd "$WORK" && for app in web business; do
  bunx svgo "$REPO/apps/$app/public/Openbookings-logo-v2.svg" -o "$REPO/apps/$app/public/Openbookings-logo-v2.svg"
done
cd "$REPO"
```
Expected: svgo reports a reduction for both files.

- [ ] **Step 3: Check them by eye**

Open each changed file (`open apps/business/public/founder.png`, and so on) and confirm it is intact: transparency preserved, no banding on the logo, the SVG still draws. Then in the browser check the business marketing page (wordmark in the nav, logo in the footer, founder portrait), the checkout summary logo, and the favicon/icon that `apps/web/app/layout.tsx` takes from the SVG.

If any image looks degraded, restore it with `git checkout -- <path>` and rerun with a larger width for that file only.

- [ ] **Step 4: Commit**

```bash
git add apps/business/public/founder.png apps/business/public/OB-LIGHT-WORDMARK.png \
  apps/business/public/OB-LOGO-LIGHT.png apps/web/public/OB-LOGO-LIGHT.png \
  apps/web/public/profile_avatar.png apps/business/public/profile_avatar.png \
  apps/web/public/Openbookings-logo-v2.svg apps/business/public/Openbookings-logo-v2.svg
git commit -m "Shrink oversized static images to twice their rendered size"
```

`apps/business/public/OB-LOGO-DARK.png` (616 KB) is referenced nowhere in the code. Leave it and mention it in the final report.

---

### Task 11: Whole-branch verification

- [ ] **Step 1: Automated checks**

Run: `bunx turbo run typecheck lint test build`
Expected: PASS for `@openbookings/images`, `@openbookings/web`, `@openbookings/business`. Report any failure that comes from the pre-existing analytics changes separately; do not fix it here.

- [ ] **Step 2: No raw CDN image slipped through**

```bash
grep -rnE "<img\b" --include='*.tsx' apps/web apps/business --exclude-dir=node_modules --exclude-dir=.next
```
Expected remaining `<img>`: Stripe artwork (`PoliciesSection`), `powered-by-stripe.svg` (`PaymentCard`), profile avatar (`nav.tsx`), provider icons (`AuthFormFields` ×2 apps), gallery dialog `motion.img` is not matched, upload previews (`image-manager` pending, `core-info-text`), image-manager gallery (with `srcSet`), guest avatars (`messages-list`). Anything else needs converting or a reason.

```bash
grep -rnE "backgroundImage|bg-\[url" --include='*.tsx' apps/web apps/business --exclude-dir=node_modules --exclude-dir=.next
```
Expected: only the two gradient patterns in `rates-availability/_components/cell-states.tsx`.

- [ ] **Step 3: Live CDN behaviour**

```bash
B=https://cdn.openbookings.co
O="width=960,quality=75,format=auto,fit=scale-down,onerror=redirect"
curl -sI -H 'Accept: image/avif,*/*' "$B/cdn-cgi/image/$O/Public/44ca5796-7461-488a-9613-be71394d4aaa/hero-image.jpg" | grep -iE "^HTTP|content-type|content-length|cache-control|cf-cache-status|cf-resized"
curl -sI "$B/cdn-cgi/image/$O/Public/does-not-exist.jpg" | grep -iE "^HTTP|cache-control|location|cf-resized"
```
Expected: the first returns `200`, `image/avif`, well under the original's 154 KB, and — once the Cache Rules are live — a `max-age` of at least a day. The second must not be cacheable for long (a 404 or a redirect with a short or absent `max-age`).

- [ ] **Step 4: Browser pass**

With both apps running, on a throttled "Fast 4G" profile: hotel page, home, search, checkout, business login, dashboard listings. Confirm no broken images, no layout shift as images arrive, and no console errors. The only expected console noise is the dev-only "does not implement width" warning for the AVIF backdrops and any SVG host logo.

- [ ] **Step 5: Report**

Summarise what changed, the before/after transfer size of the hotel page's images from the network panel, and list: the unused `GeneralMap.tsx` and `OB-LOGO-DARK.png`; whether Task 9 completed or stopped at the CORS gate; and the two items still open with Wouter (backdrop masters, Cache Rules).

---

## Follow-up (blocked on Wouter)

When JPEG or WebP backdrop masters are uploaded to `Public/backgrounds/`, change the `file` values in `packages/images/src/backdrops.ts` to the new names, run `cd packages/images && bun test`, and confirm with `curl -sI` that one of them returns `cf-resized: internal=ok…` through `/cdn-cgi/image/`. `resolveBackdrop` already moves returning visitors off the old URLs.
