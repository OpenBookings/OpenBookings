# ---------- Builder ----------
FROM oven/bun:1-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_MAPTILER_STYLE_ID
ARG NEXT_PUBLIC_MAPTILER_API_KEY
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_MAPTILER_STYLE_ID=$NEXT_PUBLIC_MAPTILER_STYLE_ID
ENV NEXT_PUBLIC_MAPTILER_API_KEY=$NEXT_PUBLIC_MAPTILER_API_KEY
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST

RUN echo "PostHog Key: $NEXT_PUBLIC_POSTHOG_KEY" && echo "PostHog Host: $NEXT_PUBLIC_POSTHOG_HOST"

COPY package*.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build


# ---------- Production ----------
FROM oven/bun:1-alpine

WORKDIR /app

ENV NODE_ENV=production

# Create a non-root user and group
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Switch to non-root user
USER nextjs

EXPOSE 8080

CMD ["bun", "server.js"]
