# ---------- Builder ----------
# Build context must be the monorepo root: docker build -f apps/business/Dockerfile .
FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_COOKIE_VERSION

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_COOKIE_VERSION=$NEXT_PUBLIC_COOKIE_VERSION

# Copy workspace manifests for layer caching
COPY package.json bun.lock turbo.json ./
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/mailing/package.json ./packages/mailing/package.json
COPY apps/business/package.json ./apps/business/package.json

RUN bun install --frozen-lockfile || bun install

# Copy source
COPY packages/ ./packages/
COPY apps/business/ ./apps/business/

RUN cd apps/business && bun run build


# ---------- Production ----------
FROM oven/bun:1.3-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

RUN apk add --no-cache chromium

RUN mkdir -p ./apps/business/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/business/public ./apps/business/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/business/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/business/.next/static ./apps/business/.next/static

USER nextjs

EXPOSE 8081

CMD ["bun", "apps/business/server.js"]
