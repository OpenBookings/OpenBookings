# ---------- Pruner ----------
    FROM oven/bun:1.3-alpine AS pruner
    WORKDIR /app
    COPY . .
    # Pinned: the pruner has no node_modules, so an unpinned `bunx turbo` would
    # fetch whatever is latest on npm. Keep in sync with turbo in package.json (pinned exact there).
    RUN bunx turbo@2.10.8 prune @openbookings/web --docker
    
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
    # Node, not Bun, runs `next build`. Bun 1.3.14 on musl segfaults while
    # tearing down Next 16.3's build workers -- *after* the output is fully
    # written -- so a perfectly good build exits 139 (the same crash, same
    # address, hit web, business and docs at once when Next went 16.2 -> 16.3;
    # the Bun image digest was unchanged across the last green build). Bun
    # still resolves and installs the deps, and still runs the server in
    # production; only this step needs Node. Keep the major line in step with
    # `engines.node` in the root package.json.
    FROM node:22-alpine AS builder
    WORKDIR /app
    
    ARG NEXT_PUBLIC_APP_URL
    ARG NEXT_PUBLIC_MAPTILER_STYLE_ID
    ARG NEXT_PUBLIC_MAPTILER_API_KEY
    ARG NEXT_PUBLIC_POSTHOG_KEY
    ARG NEXT_PUBLIC_POSTHOG_HOST
    ARG NEXT_PUBLIC_COOKIE_VERSION
    ARG NEXT_PUBLIC_SENTRY_DSN
    ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

    ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
    ENV NEXT_PUBLIC_MAPTILER_STYLE_ID=$NEXT_PUBLIC_MAPTILER_STYLE_ID
    ENV NEXT_PUBLIC_MAPTILER_API_KEY=$NEXT_PUBLIC_MAPTILER_API_KEY
    ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
    ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
    ENV NEXT_PUBLIC_COOKIE_VERSION=$NEXT_PUBLIC_COOKIE_VERSION
    ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
    ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

    # Bun's isolated linker keeps each workspace's deps (and its .bin) in
    # <workspace>/node_modules; the root node_modules only holds the store
    # plus the root package's own deps, so copying it alone leaves no `next`.
    COPY --from=installer /app/ .
    COPY --from=pruner /app/out/full/ .

    # npm is only a script runner here: the install was Bun's, and npm just
    # puts apps/web/node_modules/.bin on PATH and runs the same `build`
    # script, so package.json stays the single source of truth.
    RUN cd apps/web && npm run build
    
    # ---------- Production ----------
    FROM oven/bun:1.3-alpine
    RUN apk add --no-cache 'openssl>=3.5.7'
    WORKDIR /app
    ENV NODE_ENV=production
    
    RUN addgroup --system --gid 1001 nodejs && \
        adduser --system --uid 1001 --ingroup nodejs nextjs
    
    RUN mkdir -p ./apps/web/public
    COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
    COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
    COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
    
    USER nextjs
    EXPOSE 8080
    CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec bun apps/web/server.js"]