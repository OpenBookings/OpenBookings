# ---------- Pruner ----------
    FROM oven/bun:1.3-alpine AS pruner
    WORKDIR /app
    COPY . .
    RUN bunx turbo prune @openbookings/business --docker
    # Produces:
    #   /app/out/json/   -> package.jsons only, for install caching
    #   /app/out/full/   -> full source of the packages actually needed
    #   /app/out/bun.lock, /app/out/package.json, /app/out/turbo.json -> at root
    
    # ---------- Installer ----------
    FROM oven/bun:1.3-alpine AS installer
    RUN apk add --no-cache openssl=3.5.7-r0
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
    ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    ARG NEXT_PUBLIC_REALTIME_WORKER_URL
    
    ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
    ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
    ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
    ENV NEXT_PUBLIC_COOKIE_VERSION=$NEXT_PUBLIC_COOKIE_VERSION
    ENV NEXT_PUBLIC_MAPTILER_API_KEY=$NEXT_PUBLIC_MAPTILER_API_KEY
    ENV NEXT_PUBLIC_MAPTILER_STYLE_ID=$NEXT_PUBLIC_MAPTILER_STYLE_ID
    ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
    ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    ENV NEXT_PUBLIC_REALTIME_WORKER_URL=$NEXT_PUBLIC_REALTIME_WORKER_URL
    
    COPY --from=installer /app/node_modules ./node_modules
    COPY --from=pruner /app/out/full/ .
    
    RUN bun run --cwd apps/business build
    
    # ---------- Production ----------
    FROM oven/bun:1.3-alpine
    RUN apk add --no-cache openssl=3.5.7-r0
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