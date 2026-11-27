# The admin console. Sits behind Cloudflare Access: the container is private
# and reachable only through the Cloudflare Tunnel that cloudflared opens from
# inside it (see docker-entrypoint.sh). Built from the repo root:
#   docker build -f apps/admin/Dockerfile -t openbookings-admin .

# ---------- Pruner ----------
FROM oven/bun:1.3-alpine AS pruner
WORKDIR /app
COPY . .
# Pinned: the pruner has no node_modules, so an unpinned `bunx turbo` would
# fetch whatever is latest on npm. Keep in sync with turbo in package.json (pinned exact there).
RUN bunx turbo@2.11.10 prune @openbookings/admin --docker

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
# Node, not Bun, runs `next build`: Bun 1.3.14 on musl segfaults while tearing
# down Next's build workers (see apps/business/Dockerfile). Keep the major line
# in step with `engines.node` in the root package.json.
FROM node:22-alpine AS builder
WORKDIR /app

# The only NEXT_PUBLIC_* values the admin reads are the two origins the
# emails it sends (cancel, refund) link to: Next inlines them at build time.
ARG NEXT_PUBLIC_WEB_URL
ARG NEXT_PUBLIC_BUSINESS_URL
ENV NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL
ENV NEXT_PUBLIC_BUSINESS_URL=$NEXT_PUBLIC_BUSINESS_URL

COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .

# npm is only a script runner here; the install was Bun's.
RUN cd apps/admin && npm run build

# ---------- cloudflared ----------
# A pinned release with its SHA-256 checked, like `scw` in ci.yml. To upgrade:
# take the new tag and the digests of its linux-amd64 and linux-arm64 assets
# from https://github.com/cloudflare/cloudflared/releases (the asset's sha256).
FROM alpine:3.22 AS cloudflared
ARG TARGETARCH
ARG CLOUDFLARED_VERSION=2026.11.2
ARG CLOUDFLARED_SHA256_AMD64=56f13335143ec0e22772963290683a84a04114a35ec64cbc794a4d39ff9bb8cf
ARG CLOUDFLARED_SHA256_ARM64=04a7b7f08bce85d56b26ffe1fdbfbb21a074495a363d16f0783c40e25b5c5281
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) sha="$CLOUDFLARED_SHA256_AMD64" ;; \
      arm64) sha="$CLOUDFLARED_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    wget -q -O /cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${TARGETARCH:-amd64}"; \
    echo "${sha}  /cloudflared" | sha256sum -c -; \
    chmod +x /cloudflared

# ---------- Production ----------
FROM oven/bun:1.3-alpine
RUN apk add --no-cache 'openssl>=3.5.7'
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=cloudflared /cloudflared /usr/local/bin/cloudflared
COPY --chmod=755 apps/admin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static

USER nextjs
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
