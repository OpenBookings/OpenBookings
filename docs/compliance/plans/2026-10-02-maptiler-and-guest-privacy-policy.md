# MapTiler Default and Guest Privacy Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove CartoDB as a map tile vendor in both apps and publish a corrected, guest-only privacy policy version (`2026-10-02`) in en/nl/fr.

**Architecture:** Each app gets a tiny `lib/map-style.ts` that builds the MapTiler style URL from env; the shared `Map` component uses it as its default and shows a visible placeholder when it is missing, so no caller passes a style any more. The policy is a new versioned MDX directory registered next to the old one; the old version stays readable at its archive URL.

**Tech Stack:** Next.js (App Router), MapLibre GL v6, MDX, Bun test runner (`bun test`), TypeScript.

**Spec:** `docs/compliance/specs/2026-10-02-maptiler-and-guest-privacy-policy-design.md`

## Global Constraints

- No request to `cartocdn.com` from either app after this change; `basemaps.cartocdn.com` is removed from the business CSP.
- When `NEXT_PUBLIC_MAPTILER_STYLE_ID` or `NEXT_PUBLIC_MAPTILER_API_KEY` is missing, the map shows a visible placeholder. It never falls back to another tile vendor.
- Policy scope is the guest site (`apps/web`) only. Nothing about hosts, Microsoft sign-in, Tirreno, Chatwoot, Mistral or Dicebear.
- A vendor is listed only if it receives guest personal data from `apps/web` today.
- Regions, verbatim: Neon `EU (Frankfurt)`; Scaleway `EU (Amsterdam)`; MapTiler `EU (France and Ireland)`; Sentry `EU (Germany)`; Upstash `UK (adequacy decision)`.
- New version id is `2026-10-02`. The `2026-09-21` version stays registered and its files are not edited.
- `en` is `status: "translated"`; `nl` and `fr` stay `status: "draft"`.
- Never change a `<Section id>`; ids must be identical across the three languages.
- Do not bump `NEXT_PUBLIC_COOKIE_VERSION`.
- Commit on a branch, not on `main`: `git checkout -b compliance/maptiler-privacy-policy` before Task 1.

**Deviation from the spec, on purpose:** the spec adds two lines about the server-side consent record (cookie table and a "Consent records — 5 years" retention row). The consent log is not built yet, and a published policy must not describe processing that does not happen. Those two lines are left out here and ship with the consent-log plan as the next policy version.

## Review Focus

1. **Only one of the two env vars is set** (style id without key, or the reverse) — the map must show the placeholder, not request a URL containing `undefined`. Pinned in Task 1.
2. **Env var set to an empty or whitespace string** (an unset CI variable arrives as `""`) — same placeholder. Pinned in Task 1.
3. **A caller still passes only one of `styles.light` / `styles.dark`** — the other theme must use the MapTiler default, and if that is missing the placeholder shows instead of a crash on theme switch. Pinned in Task 2 (manual check, step 6).
4. **A visitor opens the old archive URL** `/legal/en/privacy/v/2026-09-21` — it must still render the old wording. Pinned in Task 4.
5. **A locale's file drifts from the others** (a section id renamed or a vendor row missing in one language) — pinned in Task 4 by the cross-locale test.

---

### Task 1: MapTiler style helper (both apps)

**Files:**
- Create: `apps/web/lib/map-style.ts`
- Create: `apps/web/lib/map-style.test.ts`
- Create: `apps/business/lib/map-style.ts`
- Create: `apps/business/lib/map-style.test.ts`

**Interfaces:**
- Produces (identical in both apps):
  - `maptilerStyleUrl(styleId: string | undefined, apiKey: string | undefined): string | null`
  - `DEFAULT_MAP_STYLE: string | null`

- [ ] **Step 1: Write the failing test (web)**

`apps/web/lib/map-style.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { maptilerStyleUrl } from "./map-style";

describe("maptilerStyleUrl", () => {
  test("builds the MapTiler style URL from id and key", () => {
    expect(maptilerStyleUrl("style-1", "key-1")).toBe(
      "https://api.maptiler.com/maps/style-1/style.json?key=key-1",
    );
  });

  test("returns null when the style id is missing", () => {
    expect(maptilerStyleUrl(undefined, "key-1")).toBeNull();
  });

  test("returns null when the key is missing", () => {
    expect(maptilerStyleUrl("style-1", undefined)).toBeNull();
  });

  test("treats empty and whitespace values as missing", () => {
    expect(maptilerStyleUrl("", "key-1")).toBeNull();
    expect(maptilerStyleUrl("style-1", "   ")).toBeNull();
  });

  test("encodes values so a stray character cannot break the URL", () => {
    expect(maptilerStyleUrl("a/b", "k&x=1")).toBe(
      "https://api.maptiler.com/maps/a%2Fb/style.json?key=k%26x%3D1",
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && bun test lib/map-style.test.ts`
Expected: FAIL — `Cannot find module './map-style'`.

- [ ] **Step 3: Implement (web)**

`apps/web/lib/map-style.ts`:

```ts
/**
 * The one place the map tile vendor is decided. MapTiler is the only vendor:
 * when its configuration is missing the map shows a placeholder rather than
 * falling back to another provider, because every tile vendor sees the
 * visitor's IP address and has to be listed in the privacy policy.
 */
export function maptilerStyleUrl(
  styleId: string | undefined,
  apiKey: string | undefined,
): string | null {
  const id = styleId?.trim();
  const key = apiKey?.trim();
  if (!id || !key) return null;
  return `https://api.maptiler.com/maps/${encodeURIComponent(id)}/style.json?key=${encodeURIComponent(key)}`;
}

// Referenced as literal `process.env.NEXT_PUBLIC_*` so Next inlines them into
// the client bundle; a dynamic lookup would be undefined in the browser.
export const DEFAULT_MAP_STYLE = maptilerStyleUrl(
  process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID,
  process.env.NEXT_PUBLIC_MAPTILER_API_KEY,
);
```

- [ ] **Step 4: Run the test**

Run: `cd apps/web && bun test lib/map-style.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Same two files in the business app**

Copy both files byte for byte:

```bash
cp apps/web/lib/map-style.ts apps/business/lib/map-style.ts
cp apps/web/lib/map-style.test.ts apps/business/lib/map-style.test.ts
cd apps/business && bun test lib/map-style.test.ts
```

Expected: 5 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/map-style.ts apps/web/lib/map-style.test.ts apps/business/lib/map-style.ts apps/business/lib/map-style.test.ts
git commit -m "feat(maps): add MapTiler style helper as the single tile-vendor decision"
```

---

### Task 2: Web map uses MapTiler by default

**Files:**
- Modify: `apps/web/components/ui/map.tsx:62-65` (default styles), `:71` (doc comment), `:107-113` (`mapStyles`), `:117-122` (init effect), `:156-162` (theme effect), `:185-193` (render)
- Modify: `apps/web/app/p/[hotel_slug]/_components/LocationSection.tsx:7-8,47-56`
- Modify: `apps/web/components/GeneralMap.tsx`

**Interfaces:**
- Consumes: `DEFAULT_MAP_STYLE: string | null` from `@/lib/map-style` (Task 1).
- Produces: `<Map>` with no `styles` prop renders MapTiler, or a "Map unavailable" placeholder.

- [ ] **Step 1: Replace the Carto defaults**

In `apps/web/components/ui/map.tsx`, add to the imports (after the `next-themes` import):

```ts
import { DEFAULT_MAP_STYLE } from "@/lib/map-style";
```

Delete this block:

```ts
const defaultStyles = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};
```

Change the `styles` doc comment from

```ts
  /** Custom map styles for light and dark themes. Overrides the default Carto styles. */
```

to

```ts
  /** Custom map styles for light and dark themes. Overrides the default MapTiler style. */
```

- [ ] **Step 2: Add the placeholder component**

Directly below `DefaultLoader` in the same file:

```tsx
const MapUnavailable = () => (
  <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
    <p className="text-sm text-muted-foreground">Map unavailable</p>
  </div>
);
```

- [ ] **Step 3: Use the default and guard a missing style**

Replace the `mapStyles` memo with:

```ts
  const mapStyles = useMemo(
    () => ({
      dark: styles?.dark ?? DEFAULT_MAP_STYLE,
      light: styles?.light ?? DEFAULT_MAP_STYLE,
    }),
    [styles]
  );
  // MapTiler is the only tile vendor. With no style there is nothing to
  // render, and falling back to another provider is not allowed.
  const hasStyle = mapStyles.dark !== null && mapStyles.light !== null;
```

In the init effect, replace

```ts
    if (!containerRef.current) return;

    const initialStyle =
      resolvedTheme === "dark" ? mapStyles.dark : mapStyles.light;
    currentStyleRef.current = initialStyle;
```

with

```ts
    if (!containerRef.current) return;

    const initialStyle =
      resolvedTheme === "dark" ? mapStyles.dark : mapStyles.light;
    if (!initialStyle) return;
    currentStyleRef.current = initialStyle;
```

In the theme effect, replace

```ts
    if (currentStyleRef.current === newStyle) return;
```

with

```ts
    if (!newStyle || currentStyleRef.current === newStyle) return;
```

In the returned JSX, replace

```tsx
        {isLoading && <DefaultLoader />}
```

with

```tsx
        {!hasStyle ? <MapUnavailable /> : isLoading && <DefaultLoader />}
```

- [ ] **Step 4: Drop the hand-built URLs in callers**

`apps/web/app/p/[hotel_slug]/_components/LocationSection.tsx`: delete the two lines

```ts
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
  const MTStyleKey = process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID;
```

and delete the whole `styles={ ... }` prop on `<Map>` (the conditional object with `dark` and `light`), leaving:

```tsx
                <Map
                  center={[hotel.lon, hotel.lat]}
                  zoom={14}
                  interactive={false}
                >
```

`apps/web/components/GeneralMap.tsx`: replace the whole file with

```tsx
"use client";

import { Card } from "./ui/card";
import { Map, MapControls } from "./ui/map";

export default function GeneralMap() {
  return (
    <Card className="h-full w-full p-0 overflow-hidden">
      <Map center={[-74.006, 40.7128]} zoom={11}>
        <MapControls />
      </Map>
    </Card>
  );
}
```

- [ ] **Step 5: Typecheck and confirm Carto is gone**

Run: `cd apps/web && bun run typecheck && bun run lint`
Expected: no errors.

Run: `grep -rn -i "carto" apps/web --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next`
Expected: no output.

- [ ] **Step 6: Check in the browser**

Run `bun run dev` in `apps/web`, open a property page (`/p/<any seeded slug>`), and in DevTools → Network filter on `carto`: expected zero requests, and tiles load from `api.maptiler.com`. Then stop the server, start it with the key blanked (`NEXT_PUBLIC_MAPTILER_API_KEY= bun run dev`), reload: expected the text "Map unavailable" where the map was, no console exception, and still no `carto` request. Toggle the OS light/dark setting on that page: expected no exception.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ui/map.tsx "apps/web/app/p/[hotel_slug]/_components/LocationSection.tsx" apps/web/components/GeneralMap.tsx
git commit -m "feat(web): default maps to MapTiler and remove the Carto fallback"
```

---

### Task 3: Business map uses MapTiler by default, CSP cleaned

**Files:**
- Modify: `apps/business/components/ui/map.tsx:47-50` (default styles), `:149` (doc comment), `:242-248` (`mapStyles`), `:262-267` (init effect), `:369-375` (theme effect), `:404-408` (render)
- Modify: `apps/business/app/(dashboard)/dashboard/listings/property/_components/sections/location.tsx:93-98,239`
- Modify: `apps/business/app/(onboarding)/onboarding/_steps/core-info-location.tsx:11-12,231`
- Modify: `apps/business/next.config.ts:23`

**Interfaces:**
- Consumes: `DEFAULT_MAP_STYLE: string | null` from `@/lib/map-style` (Task 1).

- [ ] **Step 1: Replace the Carto defaults**

In `apps/business/components/ui/map.tsx`, add below the `cn` import:

```ts
import { DEFAULT_MAP_STYLE } from "@/lib/map-style";
```

Delete:

```ts
const defaultStyles = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};
```

Change the `styles` doc comment's "Overrides the default Carto styles." to "Overrides the default MapTiler style."

- [ ] **Step 2: Use the default and guard a missing style**

Replace the `mapStyles` memo with:

```ts
  const mapStyles = useMemo(
    () => ({
      dark: styles?.dark ?? DEFAULT_MAP_STYLE,
      light: styles?.light ?? DEFAULT_MAP_STYLE,
    }),
    [styles],
  );
  // MapTiler is the only tile vendor. With no style there is nothing to
  // render, and falling back to another provider is not allowed.
  const hasStyle = mapStyles.dark !== null && mapStyles.light !== null;
```

In the "Initialize the map" effect, add one line after `initialStyle` is computed:

```ts
    const initialStyle =
      resolvedTheme === "dark" ? mapStyles.dark : mapStyles.light;
    if (!initialStyle) return;
    currentStyleRef.current = initialStyle;
```

In the "Handle style change" effect, replace

```ts
    if (currentStyleRef.current === newStyle) return;
```

with

```ts
    if (!newStyle || currentStyleRef.current === newStyle) return;
```

In the returned JSX, replace

```tsx
        {!isLoaded && failure ? (
          <MapFailure message={failure} />
        ) : (
          (!isLoaded || loading) && <DefaultLoader />
        )}
```

with

```tsx
        {!hasStyle ? (
          <MapFailure message="Map tiles are not configured." />
        ) : !isLoaded && failure ? (
          <MapFailure message={failure} />
        ) : (
          (!isLoaded || loading) && <DefaultLoader />
        )}
```

- [ ] **Step 3: Drop the hand-built URLs in callers**

`sections/location.tsx`: delete

```ts
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
  const styleId = process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID;
  const mapStyle =
    maptilerKey && styleId
      ? `https://api.maptiler.com/maps/${styleId}/style.json?key=${maptilerKey}`
      : undefined;
```

and delete the prop line

```tsx
                styles={mapStyle ? { dark: mapStyle, light: mapStyle } : undefined}
```

`_steps/core-info-location.tsx`: delete

```ts
const MAPTILER_STYLE_ID = process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID ?? "";
const MAP_STYLE = `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID}/style.json?key=${MAPTILER_KEY}`;
```

and delete the prop line

```tsx
          styles={{ light: MAP_STYLE, dark: MAP_STYLE }}
```

Keep `MAPTILER_KEY`: the geocoding request on line 102 still uses it.

- [ ] **Step 4: Remove Carto from the CSP**

In `apps/business/next.config.ts`, in the `connect-src` line, delete the token ` https://basemaps.cartocdn.com` (with its leading space). The line then reads `... https://*.posthog.com https://api.maptiler.com https://connect-js.stripe.com ...`.

- [ ] **Step 5: Typecheck, lint, confirm Carto is gone**

Run: `cd apps/business && bun run typecheck && bun run lint`
Expected: no errors (in particular no "unused variable" for the removed constants).

Run: `grep -rn -i "carto" apps packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next`
Expected: no output.

- [ ] **Step 6: Check in the browser**

Run `bun run dev` in `apps/business`. Open Listings → Property → Location and the onboarding address step: expected the map renders, the pin can be moved, address search still returns suggestions, zero `carto` requests, and no CSP violation in the console.

- [ ] **Step 7: Commit**

```bash
git add apps/business/components/ui/map.tsx "apps/business/app/(dashboard)/dashboard/listings/property/_components/sections/location.tsx" "apps/business/app/(onboarding)/onboarding/_steps/core-info-location.tsx" apps/business/next.config.ts
git commit -m "feat(business): default maps to MapTiler and drop Carto from the CSP"
```

---

### Task 4: Guest privacy policy version 2026-10-02

**Files:**
- Create: `apps/web/content/legal/privacy/2026-10-02/en.mdx`, `nl.mdx`, `fr.mdx`
- Modify: `apps/web/lib/legal/documents.ts:102-127`
- Create: `apps/web/lib/legal/documents.test.ts`

**Interfaces:**
- Consumes: existing `LEGAL_DOCUMENTS`, `getDocument`, `getVersion`, `getCurrentVersion` from `apps/web/lib/legal/documents.ts`.
- Produces: `privacy@2026-10-02/<locale>` as the current document id.

- [ ] **Step 1: Write the failing test**

`apps/web/lib/legal/documents.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentVersion, getDocument, getVersion, LEGAL_LOCALES } from "./documents";

const DIR = join(import.meta.dir, "../../content/legal/privacy");
const read = (version: string, locale: string) =>
  readFileSync(join(DIR, version, `${locale}.mdx`), "utf8");
const sectionIds = (source: string) =>
  [...source.matchAll(/<Section id="([^"]+)"/g)].map((m) => m[1]);

describe("privacy policy registry", () => {
  const doc = getDocument("privacy")!;

  test("2026-10-02 is the current version", () => {
    expect(getCurrentVersion(doc).version).toBe("2026-10-02");
  });

  test("the superseded version stays registered for its archive URL", () => {
    const old = getVersion(doc, "2026-09-21");
    expect(old).toBeDefined();
    expect(Object.keys(old!.locales).sort()).toEqual(["en", "fr", "nl"]);
  });

  test("only English is marked translated", () => {
    const { locales } = getCurrentVersion(doc);
    expect(locales.en?.status).toBe("translated");
    expect(locales.nl?.status).toBe("draft");
    expect(locales.fr?.status).toBe("draft");
  });
});

describe("privacy policy 2026-10-02 content", () => {
  for (const locale of LEGAL_LOCALES) {
    const source = read("2026-10-02", locale);

    test(`${locale}: names the real vendors`, () => {
      for (const vendor of ["Neon", "Scaleway", "Upstash", "Algolia", "MapTiler", "Lettermint", "PostHog", "Sentry", "Cloudflare", "Stripe"]) {
        expect(source).toContain(`**${vendor}**`);
      }
    });

    test(`${locale}: does not name vendors that get no guest data`, () => {
      for (const absent of ["Google Cloud", "Tirreno", "Chatwoot", "Mistral", "Carto", "Dicebear", "Microsoft"]) {
        expect(source).not.toContain(absent);
      }
    });

    test(`${locale}: keeps the same section ids as the previous version`, () => {
      expect(sectionIds(source)).toEqual(sectionIds(read("2026-09-21", "en")));
    });
  }

  test("the previous version's files are untouched", () => {
    expect(read("2026-09-21", "en")).toContain("**Google Cloud**");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && bun test lib/legal/documents.test.ts`
Expected: FAIL — current version is `2026-09-21`, and `ENOENT` for the `2026-10-02` files.

- [ ] **Step 3: Create the new version from the old one**

```bash
cp -R apps/web/content/legal/privacy/2026-09-21 apps/web/content/legal/privacy/2026-10-02
```

All edits in steps 4–6 are to the files under `2026-10-02/` only.

- [ ] **Step 4: Edit `2026-10-02/en.mdx`**

Replace the second paragraph of `<Lead>`:

```mdx
This policy applies to [openbookings.co](https://openbookings.co) and all related services operated by OpenBookings B.V., registered in the Netherlands.
```

with

```mdx
This policy is for guests: people who use [openbookings.co](https://openbookings.co) to search for and book a stay. It is operated by OpenBookings B.V., registered in the Netherlands.

Run a property on OpenBookings? The business portal is covered by your Partner Agreement, not by this policy.
```

In 2.1, replace

```mdx
Your email address, name and your profile picture when you sign in with Google.
```

with

```mdx
Your email address and name. If you sign in with Google or Apple, we also receive the name and profile picture that provider shares with us.
```

Replace the whole vendor table and the Note directly under it (from `| Vendor | What they get |` through the "For the last two" Note) with:

```mdx
| Vendor | What they get | What for | Where |
| --- | --- | --- | --- |
| **Neon** | Account and booking records | Database hosting | EU (Frankfurt) |
| **Scaleway** | Data processed by the app while it runs | Application hosting | EU (Amsterdam) |
| **Upstash** | Cached query results | Caching | UK (adequacy decision) |
| **Algolia** | Search queries, IP address | Destination search | EU |
| **MapTiler** | IP address, the map area you look at | Map tiles | EU (France and Ireland) |
| **Lettermint** | Email address, booking details | Sending transactional emails | EU |
| **PostHog** | Usage events, session recordings, account ID when signed in (no name or email) | Product analytics, only with your consent | EU |
| **Sentry** | Error reports, stack traces, browser type | Error tracking | EU (Germany) |
| **Cloudflare** | IP address, request metadata, messages while they are being delivered | CDN, bot protection, rate limiting, message delivery | EU/US (SCCs) |
| **Stripe** | Name, email, booking amount | Payment processing | US/EU (SCCs) |

<Note>For Cloudflare and Stripe, where data can leave the EU, we use Standard Contractual Clauses approved by the European Commission. Upstash stores data in the United Kingdom, which the European Commission recognises as providing adequate protection.</Note>

**Sign-in providers.** If you choose to sign in with Google or Apple, that company handles the sign-in under its own privacy policy and tells us your email address and name. You can always sign in with an email link instead.
```

In section 6, replace

```mdx
- Infrastructure is on Google Cloud with access controls and audit logging.
```

with

```mdx
- Infrastructure is hosted in the EU on Scaleway, with access controls and audit logging.
```

- [ ] **Step 5: Edit `2026-10-02/nl.mdx`**

In the header comment, change `Translated from en.mdx at version 2026-09-21.` to `Translated from en.mdx at version 2026-10-02.`

Replace the second `<Lead>` paragraph (`Dit beleid geldt voor …, gevestigd in Nederland.`) with:

```mdx
Dit beleid is bedoeld voor gasten: mensen die [openbookings.co](https://openbookings.co) gebruiken om een verblijf te zoeken en te boeken. Het platform wordt geleverd door OpenBookings B.V., gevestigd in Nederland.

Beheert u een accommodatie op OpenBookings? Voor het zakelijke portaal geldt uw Partnerovereenkomst, niet dit beleid.
```

In 2.1, replace the sentence that mentions signing in with Google with:

```mdx
Uw e-mailadres en naam. Als u inlogt met Google of Apple, ontvangen wij ook de naam en profielfoto die die aanbieder met ons deelt.
```

Replace the vendor table and the Note under it (from `| Leverancier | Wat zij ontvangen |` through the `Voor de laatste twee` Note) with:

```mdx
| Leverancier | Wat zij ontvangen | Waarvoor | Waar |
| --- | --- | --- | --- |
| **Neon** | Account- en boekingsgegevens | Databasehosting | EU (Frankfurt) |
| **Scaleway** | Gegevens die de applicatie tijdens gebruik verwerkt | Applicatiehosting | EU (Amsterdam) |
| **Upstash** | Gecachte zoekresultaten | Caching | VK (adequaatheidsbesluit) |
| **Algolia** | Zoekopdrachten, IP-adres | Bestemmingszoekfunctie | EU |
| **MapTiler** | IP-adres, het kaartgebied dat u bekijkt | Kaarttegels | EU (Frankrijk en Ierland) |
| **Lettermint** | E-mailadres, boekingsgegevens | Versturen van transactionele e-mails | EU |
| **PostHog** | Gebruiksevents, sessie-opnames, account-ID bij inloggen (geen naam of e-mailadres) | Productanalyse, alleen met uw toestemming | EU |
| **Sentry** | Foutrapporten, stacktraces, browsertype | Foutregistratie | EU (Duitsland) |
| **Cloudflare** | IP-adres, verzoekmetadata, berichten tijdens de aflevering | CDN, botbescherming, snelheidsbeperking, berichtaflevering | EU/VS (SCC's) |
| **Stripe** | Naam, e-mailadres, boekingsbedrag | Betalingsverwerking | VS/EU (SCC's) |

<Note>Voor Cloudflare en Stripe, waar gegevens de EU kunnen verlaten, gebruiken wij standaardcontractbepalingen die zijn goedgekeurd door de Europese Commissie. Upstash slaat gegevens op in het Verenigd Koninkrijk, dat volgens de Europese Commissie een passend beschermingsniveau biedt.</Note>

**Inlogaanbieders.** Als u ervoor kiest in te loggen met Google of Apple, handelt dat bedrijf het inloggen af onder zijn eigen privacybeleid en geeft het ons uw e-mailadres en naam door. U kunt altijd inloggen met een e-maillink.
```

In section 6, replace

```mdx
- De infrastructuur draait op Google Cloud met toegangscontrole en auditlogging.
```

with

```mdx
- De infrastructuur wordt in de EU gehost bij Scaleway, met toegangscontrole en auditlogging.
```

- [ ] **Step 6: Edit `2026-10-02/fr.mdx`**

In the header comment, change `2026-09-21` to `2026-10-02`.

Replace the second `<Lead>` paragraph (`Cette politique s'applique à …`) with:

```mdx
Cette politique s'adresse aux voyageurs : les personnes qui utilisent [openbookings.co](https://openbookings.co) pour rechercher et réserver un séjour. La plateforme est exploitée par OpenBookings B.V., société enregistrée aux Pays-Bas.

Vous gérez un établissement sur OpenBookings ? Le portail professionnel relève de votre Contrat de partenariat, et non de la présente politique.
```

In 2.1, replace the sentence that mentions signing in with Google with:

```mdx
Votre adresse e-mail et votre nom. Si vous vous connectez avec Google ou Apple, nous recevons également le nom et la photo de profil que ce fournisseur partage avec nous.
```

Replace the vendor table and the Note under it (from `| Prestataire | Ce qu'il reçoit |` through the `Pour les deux derniers` Note) with:

```mdx
| Prestataire | Ce qu'il reçoit | Pourquoi | Où |
| --- | --- | --- | --- |
| **Neon** | Données de compte et de réservation | Hébergement de la base de données | UE (Francfort) |
| **Scaleway** | Données traitées par l'application pendant son exécution | Hébergement applicatif | UE (Amsterdam) |
| **Upstash** | Résultats de requêtes mis en cache | Mise en cache | Royaume-Uni (décision d'adéquation) |
| **Algolia** | Requêtes de recherche, adresse IP | Recherche de destinations | UE |
| **MapTiler** | Adresse IP, zone de la carte consultée | Tuiles cartographiques | UE (France et Irlande) |
| **Lettermint** | Adresse e-mail, détails de réservation | Envoi des e-mails transactionnels | UE |
| **PostHog** | Événements d'usage, enregistrements de session, identifiant de compte lorsque vous êtes connecté (ni nom ni e-mail) | Analyse produit, uniquement avec votre consentement | UE |
| **Sentry** | Rapports d'erreur, traces d'appels, type de navigateur | Suivi des erreurs | UE (Allemagne) |
| **Cloudflare** | Adresse IP, métadonnées de requête, messages pendant leur acheminement | CDN, protection anti-bots, limitation de débit, acheminement des messages | UE/États-Unis (CCT) |
| **Stripe** | Nom, e-mail, montant de la réservation | Traitement des paiements | États-Unis/UE (CCT) |

<Note>Pour Cloudflare et Stripe, lorsque des données peuvent quitter l'UE, nous recourons aux clauses contractuelles types approuvées par la Commission européenne. Upstash conserve les données au Royaume-Uni, dont la Commission européenne reconnaît le niveau de protection adéquat.</Note>

**Fournisseurs de connexion.** Si vous choisissez de vous connecter avec Google ou Apple, cette société gère la connexion selon sa propre politique de confidentialité et nous transmet votre adresse e-mail et votre nom. Vous pouvez toujours vous connecter par lien e-mail.
```

In section 6, replace

```mdx
- L'infrastructure est hébergée sur Google Cloud, avec contrôles d'accès et journalisation d'audit.
```

with

```mdx
- L'infrastructure est hébergée dans l'UE chez Scaleway, avec contrôles d'accès et journalisation d'audit.
```

- [ ] **Step 7: Register the new version**

In `apps/web/lib/legal/documents.ts`, change `currentVersion: "2026-09-21"` to `currentVersion: "2026-10-02"` and add this entry as the **first** element of `versions` (the existing `2026-09-21` entry stays, unchanged, after it):

```ts
      {
        version: "2026-10-02",
        effectiveFrom: "2026-10-02",
        lastUpdated: "2026-10-02",
        locales: {
          en: {
            status: "translated",
            load: () => import("@/content/legal/privacy/2026-10-02/en.mdx"),
          },
          nl: {
            status: "draft",
            load: () => import("@/content/legal/privacy/2026-10-02/nl.mdx"),
          },
          fr: {
            status: "draft",
            load: () => import("@/content/legal/privacy/2026-10-02/fr.mdx"),
          },
        },
      },
```

Update the example in the `documentVersionId` doc comment from `privacy@2026-09-21/nl` to `privacy@2026-10-02/nl`.

- [ ] **Step 8: Run the tests**

Run: `cd apps/web && bun test lib/legal/documents.test.ts`
Expected: all pass, 0 fail.

Run: `cd apps/web && bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 9: Check the rendered pages**

Run `bun run dev` in `apps/web` and open:
- `/privacy` → redirects to the policy; the vendor table shows Scaleway and MapTiler, no Google Cloud.
- `/legal/nl/privacy` and `/legal/fr/privacy` → new wording, draft banner still shown.
- `/legal/en/privacy/v/2026-09-21` → the old wording, including the Google Cloud row.

Expected: no MDX compile error in the terminal on any of the four.

- [ ] **Step 10: Commit**

```bash
git add apps/web/content/legal/privacy/2026-10-02 apps/web/lib/legal/documents.ts apps/web/lib/legal/documents.test.ts
git commit -m "feat(legal): publish guest privacy policy 2026-10-02 with the real vendor list"
```

---

## Left for Wouter

- The English text should be read by whoever signs off legal copy before this is deployed; `nl` and `fr` are my translations and stay marked draft until reviewed.
- If the effective date should be later than 2 October 2026 (for example to give notice), change `effectiveFrom` in Task 4 Step 7.
