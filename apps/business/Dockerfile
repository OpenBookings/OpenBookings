# ---------- Pruner ----------
    FROM oven/bun:1.3-alpine AS pruner
    WORKDIR /app
    COPY . .
    # Pinned: the pruner has no node_modules, so an unpinned `bunx turbo` would
    # fetch whatever is latest on npm. Keep in sync with turbo in package.json (pinned exact there).
    RUN bunx turbo@2.10.8 prune @openbookings/business --docker
    # Produces:
    #   /app/out/json/   -> package.jsons only, for install caching
    #   /app/out/full/   -> full source of the packages actually needed
    #   /app/out/bun.lock, /app/out/package.json, /app/out/turbo.json -> at root
    
    # ---------- Installer ----------
    FROM oven/bun:1.3-alpine AS installer
    # Floor, not an exact pin: Alpine drops old -rN revisions when the repo
    # rotates, which turns an exact pin into a sudden 404 on an unrelated day.
    RUN apk add --no-cache 'openssl>=3.5.7'
    WORKDIR /app
    
    COPY --from=pruner /app/out/json/ .
    COPY --from=pruner /app/out/bun.lock ./bun.lock
    
    RUN bun install --frozen-lockfile
    
    # ---------- Builder ----------
    FROM oven/bun:1.3-alpine AS builder
    WORKDIR /app
    
    ARG NEXT_PUBLIC_APP_URL
    ARG NEXT_PUBLIC_POSTHOG_KEY
    ARG NEXT_PUBLIC_POSTHOG_HOST
    ARG NEXT_PUBLIC_COOKIE_VERSION
    ARG NEXT_PUBLIC_MAPTILER_API_KEY
    ARG NEXT_PUBLIC_MAPTILER_STYLE_ID
    ARG NEXT_PUBLIC_SENTRY_DSN
    ARG NEXT_PUBLIC_REALTIME_WORKER_URL
    ARG NEXT_PUBLIC_CHATWOOT_BASE_URL
    ARG NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN

    ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
    ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
    ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
    ENV NEXT_PUBLIC_COOKIE_VERSION=$NEXT_PUBLIC_COOKIE_VERSION
    ENV NEXT_PUBLIC_MAPTILER_API_KEY=$NEXT_PUBLIC_MAPTILER_API_KEY
    ENV NEXT_PUBLIC_MAPTILER_STYLE_ID=$NEXT_PUBLIC_MAPTILER_STYLE_ID
    ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
    ENV NEXT_PUBLIC_REALTIME_WORKER_URL=$NEXT_PUBLIC_REALTIME_WORKER_URL
    ENV NEXT_PUBLIC_CHATWOOT_BASE_URL=$NEXT_PUBLIC_CHATWOOT_BASE_URL
    ENV NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN=$NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN

    # Bun's isolated linker keeps each workspace's deps (and its .bin) in
    # <workspace>/node_modules; the root node_modules only holds the store
    # plus the root package's own deps, so copying it alone leaves no `next`.
    COPY --from=installer /app/ .
    COPY --from=pruner /app/out/full/ .

    RUN bun run --cwd apps/business build
    
    # ---------- Production ----------
    FROM oven/bun:1.3-alpine
    RUN apk add --no-cache 'openssl>=3.5.7'
    WORKDIR /app
    ENV NODE_ENV=production
    
    RUN addgroup --system --gid 1001 nodejs && \
        adduser --system --uid 1001 --ingroup nodejs nextjs
    
    RUN mkdir -p ./apps/business/public
    COPY --from=builder --chown=nextjs:nodejs /app/apps/business/public ./apps/business/public
    COPY --from=builder --chown=nextjs:nodejs /app/apps/business/.next/standalone ./
    COPY --from=builder --chown=nextjs:nodejs /app/apps/business/.next/static ./apps/business/.next/static
    
    USER nextjs
    EXPOSE 8081
    CMD ["bun", "apps/business/server.js"]