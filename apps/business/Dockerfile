# ---------- Builder ----------
FROM oven/bun:1.3-alpine AS builder

RUN apk add --no-cache openssl=3.5.7-r0

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

# Copy workspace manifests for layer caching
COPY package.json bun.lock turbo.json ./
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/authz/package.json ./packages/authz/package.json
COPY packages/mailing/package.json ./packages/mailing/package.json
COPY packages/messaging/package.json ./packages/messaging/package.json
COPY packages/analytics/package.json ./packages/analytics/package.json
COPY packages/stripe/package.json ./packages/stripe/package.json
COPY apps/business/package.json ./apps/business/package.json

RUN bun install --frozen-lockfile || bun install

# Copy source
COPY packages/ ./packages/
COPY apps/business/ ./apps/business/

RUN cd apps/business && bun run build


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
