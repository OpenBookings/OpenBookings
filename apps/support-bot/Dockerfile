# support-bot is a Bun/Hono service, not Next.js: Bun runs the TypeScript
# directly, so there is no bundle to emit. The "builder" stage is therefore a
# typecheck gate (`bun run build` -> `tsc --noEmit`) that fails the image
# before it can ship, and the runtime stage carries source + prod deps only.

# ---------- Pruner ----------
    FROM oven/bun:1.3-alpine AS pruner
    WORKDIR /app
    COPY . .
    # Pinned: the pruner has no node_modules, so an unpinned `bunx turbo` would
    # fetch whatever is latest on npm. Keep in sync with turbo in package.json (pinned exact there).
    RUN bunx turbo@2.10.8 prune @openbookings/support-bot --docker
    # Produces:
    #   /app/out/json/   -> package.jsons only, for install caching
    #   /app/out/full/   -> full source of the packages actually needed
    #   /app/out/bun.lock, /app/out/package.json, /app/out/turbo.json -> at root

# ---------- Installer (dev deps included, for the typecheck) ----------
    FROM oven/bun:1.3-alpine AS installer
    # Floor, not an exact pin: Alpine drops old -rN revisions when the repo
    # rotates, which turns an exact pin into a sudden 404 on an unrelated day.
    RUN apk add --no-cache 'openssl>=3.5.7'
    WORKDIR /app

    COPY --from=pruner /app/out/json/ .
    COPY --from=pruner /app/out/bun.lock ./bun.lock

    RUN bun install --frozen-lockfile

# ---------- Builder (typecheck gate) ----------
    FROM oven/bun:1.3-alpine AS builder
    WORKDIR /app

    # Bun's isolated linker keeps each workspace's deps (and its .bin) in
    # <workspace>/node_modules; the root node_modules only holds the store
    # plus the root package's own deps, so copying it alone leaves no `tsc`.
    COPY --from=installer /app/ .
    COPY --from=pruner /app/out/full/ .

    RUN bun run --cwd apps/support-bot build

# ---------- Production deps (no dev deps) ----------
    # Derived FROM builder on purpose. BuildKit only builds stages the target
    # depends on, so a standalone deps stage would let the typecheck above be
    # skipped entirely. Chaining it here makes `tsc` a hard gate on the image.
    FROM builder AS prod-deps
    RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules && \
        bun install --frozen-lockfile --production

# ---------- Production ----------
    FROM oven/bun:1.3-alpine
    RUN apk add --no-cache 'openssl>=3.5.7'
    WORKDIR /app
    ENV NODE_ENV=production

    RUN addgroup --system --gid 1001 nodejs && \
        adduser --system --uid 1001 --ingroup nodejs hono

    # prod-deps already carries the pruned source (it derives from builder),
    # so this single copy brings source and production node_modules together.
    COPY --from=prod-deps --chown=hono:nodejs /app/ .

    USER hono
    # Cloud Run injects PORT; Bun's default export honours it, and 8080 is the
    # fallback used when running the image directly.
    ENV PORT=8080
    EXPOSE 8080
    CMD ["bun", "run", "apps/support-bot/src/index.ts"]
