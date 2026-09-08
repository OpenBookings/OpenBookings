# ---------- Pruner ----------
    FROM oven/bun:1.3-alpine AS pruner
    WORKDIR /app
    COPY . .
    # Pinned: the pruner has no node_modules, so an unpinned `bunx turbo` would
    # fetch whatever is latest on npm. Keep in sync with turbo in package.json (pinned exact there).
    RUN bunx turbo@2.10.8 prune @openbookings/docs --docker

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

    # Bun's isolated linker keeps each workspace's deps (and its .bin) in
    # <workspace>/node_modules; the root node_modules only holds the store
    # plus the root package's own deps, so copying it alone leaves no `next`.
    COPY --from=installer /app/ .
    COPY --from=pruner /app/out/full/ .

    RUN bun run --cwd apps/docs build
    # The docs app ships no static assets today; the production stage still
    # copies a public/ so adding one later needs no Dockerfile change.
    RUN mkdir -p apps/docs/public

    # ---------- Production ----------
    FROM oven/bun:1.3-alpine
    RUN apk add --no-cache 'openssl>=3.5.7'
    WORKDIR /app
    ENV NODE_ENV=production

    RUN addgroup --system --gid 1001 nodejs && \
        adduser --system --uid 1001 --ingroup nodejs nextjs

    RUN mkdir -p ./apps/docs/public
    COPY --from=builder --chown=nextjs:nodejs /app/apps/docs/public ./apps/docs/public
    COPY --from=builder --chown=nextjs:nodejs /app/apps/docs/.next/standalone ./
    COPY --from=builder --chown=nextjs:nodejs /app/apps/docs/.next/static ./apps/docs/.next/static

    USER nextjs
    ENV PORT=8082
    EXPOSE 8082
    CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec bun apps/docs/server.js"]
